import { contains, runUnitOfWork, type Backend, type Changes, type Doc, type Store, type Tx, type TxOptions } from "./store.ts";

/**
 * In-process store for unit tests and database-less local development. Units of work run one at a time
 * (a simple queue), so it gives the same isolation guarantees as row locking without any concurrency.
 * Documents are kept as JSON text, so callers can never mutate stored state without a `put`.
 */
export class MemoryStore implements Store {
  private readonly colls = new Map<string, Map<string, string>>();
  private readonly logs = new Map<string, string[]>();
  private queue: Promise<unknown> = Promise.resolve();

  run<T>(fn: (tx: Tx) => Promise<T>, opts?: TxOptions): Promise<T> {
    const go = () => runUnitOfWork(async () => this.backend(), fn, opts);
    const next = this.queue.then(go, go);
    this.queue = next.catch(() => {});
    return next;
  }

  async close() {}

  private coll(name: string) {
    let m = this.colls.get(name);
    if (!m) { m = new Map(); this.colls.set(name, m); }
    return m;
  }

  private backend(): Backend {
    return {
      load: async (coll, key) => { const s = this.coll(coll).get(key); return s === undefined ? undefined : (JSON.parse(s) as Doc); },
      query: async (coll, match) => {
        const out: { key: string; doc: Doc }[] = [];
        for (const [key, s] of this.coll(coll)) { const doc = JSON.parse(s) as Doc; if (contains(doc, match)) out.push({ key, doc }); }
        return out;
      },
      queryLog: async (log, match) => (this.logs.get(log) ?? []).map((s, i) => ({ seq: i + 1, ...JSON.parse(s) })).filter((d) => contains(d, match)),
      commit: async (c: Changes) => {
        for (const d of c.deletes) this.coll(d.coll).delete(d.key);
        for (const w of [...c.updates, ...c.inserts, ...c.upserts]) this.coll(w.coll).set(w.key, JSON.stringify(w.doc));
        for (const a of c.appends) { let l = this.logs.get(a.log); if (!l) { l = []; this.logs.set(a.log, l); } l.push(JSON.stringify(a.doc)); }
      },
      rollback: async () => {},
    };
  }

  /** Test helper: number of stored documents in a collection. */
  count(coll: string) { return this.coll(coll).size; }
}
