/**
 * Persistence model: every aggregate is a JSON document in a named collection, keyed by its id, plus a few
 * append-only logs. Application code works through a `Tx` (one unit of work per request or job):
 *
 * - reads go to the backend once and are then served from the transaction's identity map, so a service can
 *   load the same entity twice and see its own pending changes;
 * - writes are explicit (`put`, `delete`, `append`) and are flushed once, at commit, in a single database
 *   transaction;
 * - in a write transaction every row read is locked (`SELECT … FOR UPDATE`), so concurrent requests that touch
 *   the same lot, offer or deal serialise on those rows only.
 *
 * Queries use JSON containment (`doc @> match`), which Postgres serves from GIN indexes and the in-memory
 * backend evaluates with the same semantics.
 */

/** Documents are JSON objects: containment queries (`doc @> match`) only match objects. */
export type Doc = Record<string, unknown>;

export interface TxOptions {
  /** Lock rows read in this transaction (default true). Read-only requests pass false. */
  write?: boolean;
}

/** Backend operations used by `Tx`. Rows are returned as fresh objects the caller may mutate. */
export interface Backend {
  load(coll: string, key: string, lock: boolean): Promise<Doc | undefined>;
  query(coll: string, match: Record<string, unknown>, lock: boolean): Promise<{ key: string; doc: Doc }[]>;
  queryLog(log: string, match: Record<string, unknown>): Promise<Record<string, unknown>[]>;
  commit(changes: Changes): Promise<void>;
  rollback(): Promise<void>;
}

export interface Changes {
  /** Keys this unit of work looked up and found absent: a concurrent insert of the same key is a conflict. */
  inserts: { coll: string; key: string; doc: Doc }[];
  /** Keys written without being read first (natural keys such as a phone number): insert or overwrite. */
  upserts: { coll: string; key: string; doc: Doc }[];
  updates: { coll: string; key: string; doc: Doc }[];
  deletes: { coll: string; key: string }[];
  appends: { log: string; doc: Record<string, unknown> }[];
}

/** JSON containment with jsonb `@>` semantics: objects match by subset, arrays by "contains every element". */
export function contains(doc: unknown, match: unknown): boolean {
  if (match === null || typeof match !== "object") return doc === match;
  if (Array.isArray(match)) return Array.isArray(doc) && match.every((m) => doc.some((d) => contains(d, m)));
  if (doc === null || typeof doc !== "object" || Array.isArray(doc)) return false;
  return Object.entries(match).every(([k, v]) => v === undefined || contains((doc as Record<string, unknown>)[k], v));
}

/** Drop `undefined` fields the way JSON storage would, so both backends hold identical documents. */
const clean = <T>(v: T): T => JSON.parse(JSON.stringify(v ?? null));

interface Entry { doc: Doc | undefined; existed: boolean; dirty: boolean; read: boolean }

export class Tx {
  private readonly backend: Backend;
  readonly write: boolean;
  private readonly map = new Map<string, Map<string, Entry>>();
  private readonly appends: Changes["appends"] = [];

  constructor(backend: Backend, opts: TxOptions = {}) {
    this.backend = backend;
    this.write = opts.write ?? true;
  }

  private coll(name: string) {
    let m = this.map.get(name);
    if (!m) { m = new Map(); this.map.set(name, m); }
    return m;
  }

  async get<T>(coll: string, key: string): Promise<T | undefined> {
    const m = this.coll(coll);
    let e = m.get(key);
    if (!e) {
      const doc = await this.backend.load(coll, key, this.write);
      e = { doc, existed: doc !== undefined, dirty: false, read: true };
      m.set(key, e);
    }
    return e.doc as T | undefined;
  }

  /** All documents in `coll` containing `match`, including this transaction's unflushed writes. */
  async find<T>(coll: string, match: Record<string, unknown> = {}): Promise<T[]> {
    const m = this.coll(coll);
    const out: T[] = [];
    const seen = new Set<string>();
    for (const row of await this.backend.query(coll, match, this.write)) {
      seen.add(row.key);
      let e = m.get(row.key);
      if (!e) { e = { doc: row.doc, existed: true, dirty: false, read: true }; m.set(row.key, e); }
      if (e.doc !== undefined && contains(e.doc, match)) out.push(e.doc as T);
    }
    for (const [key, e] of m) if (!seen.has(key) && e.dirty && e.doc !== undefined && contains(e.doc, match)) out.push(e.doc as T);
    return out;
  }

  async has(coll: string, key: string) { return (await this.get(coll, key)) !== undefined; }

  /** Stage a document write; the caller passes the (possibly mutated) entity it holds. */
  put<T>(coll: string, key: string, doc: T): T {
    const m = this.coll(coll);
    const e = m.get(key);
    if (e) { e.doc = doc as Doc; e.dirty = true; }
    else m.set(key, { doc: doc as Doc, existed: false, dirty: true, read: false });
    return doc;
  }

  delete(coll: string, key: string) {
    const m = this.coll(coll);
    const e = m.get(key);
    if (e) { e.doc = undefined; e.dirty = true; }
    else m.set(key, { doc: undefined, existed: true, dirty: true, read: false });
  }

  append(log: string, doc: Record<string, unknown>) { this.appends.push({ log, doc: clean(doc) }); }

  async findLog<T>(log: string, match: Record<string, unknown> = {}): Promise<T[]> {
    const stored = await this.backend.queryLog(log, match);
    const pending = this.appends.filter((a) => a.log === log && contains(a.doc, match)).map((a) => a.doc);
    return [...stored, ...pending] as T[];
  }

  async commit() {
    const changes: Changes = { inserts: [], upserts: [], updates: [], deletes: [], appends: this.appends };
    for (const [coll, m] of this.map) {
      for (const [key, e] of m) {
        if (!e.dirty) continue;
        if (e.doc === undefined) { if (e.existed) changes.deletes.push({ coll, key }); }
        else if (e.existed) changes.updates.push({ coll, key, doc: clean(e.doc) });
        else (e.read ? changes.inserts : changes.upserts).push({ coll, key, doc: clean(e.doc) });
      }
    }
    await this.backend.commit(changes);
  }

  rollback() { return this.backend.rollback(); }
}

/** Errors that mean "another transaction got there first": the whole unit of work is retried. */
export class RetryableConflict extends Error {}

export interface Store {
  /**
   * Runs `fn` in one unit of work. Commits on success. On failure rolls back, unless the error carries
   * `persistState: true` (e.g. a failed OTP attempt that must still be counted), in which case the staged
   * changes are committed before the error is rethrown. Retryable conflicts re-run `fn` from scratch.
   */
  run<T>(fn: (tx: Tx) => Promise<T>, opts?: TxOptions): Promise<T>;
  close(): Promise<void>;
}

export async function runUnitOfWork<T>(open: () => Promise<Backend>, fn: (tx: Tx) => Promise<T>, opts: TxOptions = {}, attempts = 4): Promise<T> {
  for (let i = 1; ; i++) {
    const tx = new Tx(await open(), opts);
    try {
      let result: T;
      try {
        result = await fn(tx);
      } catch (e) {
        if ((e as { persistState?: boolean } | null)?.persistState === true) await tx.commit();
        else await tx.rollback();
        throw e;
      }
      await tx.commit();
      return result;
    } catch (e) {
      if (e instanceof RetryableConflict && i < attempts) continue;
      throw e;
    }
  }
}
