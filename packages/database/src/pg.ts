import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { RetryableConflict, runUnitOfWork, type Backend, type Changes, type Doc, type Store, type Tx, type TxOptions } from "./store.ts";

/** Document collections (one table each: `key text primary key, doc jsonb, ord bigserial`). */
export const COLLECTIONS = [
  "users", "sessions", "otps", "otp_requests", "organizations", "verification_claims", "evidence", "raw_records", "price_observations",
  "price_aggregates", "source_health", "alert_subscriptions", "ops_queue", "sell_lots", "buy_requirements", "recurrence_templates",
  "negotiation_threads", "offers", "deals", "disputes", "dispute_prior_status", "idempotency_keys", "partners", "inspections",
  "transport_requests", "transport_quotes", "member_lots", "aggregate_lots", "settlements", "media", "outbox",
] as const;
/** Append-only logs (`idx` from a sequence, `doc jsonb`). */
export const LOGS = ["audit_log", "notifications", "reputation_events", "contact_reveals", "user_reports"] as const;

const KNOWN = new Set<string>([...COLLECTIONS, ...LOGS]);
const table = (name: string) => {
  if (!KNOWN.has(name)) throw new Error(`unknown table ${name}`);
  return name;
};

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");
/** serialization_failure, deadlock_detected, unique_violation: another transaction won the race. */
const RETRYABLE = new Set(["40001", "40P01", "23505"]);

export interface PgOptions {
  connectionString: string;
  /** Isolated schema (used by tests). Created by `migrate` if missing. */
  schema?: string;
  poolSize?: number;
}

/**
 * Postgres store: each unit of work is one READ COMMITTED transaction on its own pooled connection. Rows read
 * in a write transaction are locked, so any number of API and worker processes can run side by side.
 */
export class PgStore implements Store {
  readonly pool: pg.Pool;
  private readonly opts: PgOptions;

  constructor(opts: PgOptions) {
    this.opts = opts;
    this.pool = new pg.Pool({ connectionString: opts.connectionString, max: opts.poolSize ?? 10, ...(opts.schema ? { options: `-c search_path=${opts.schema}` } : {}) });
  }

  close() { return this.pool.end(); }

  run<T>(fn: (tx: Tx) => Promise<T>, opts?: TxOptions): Promise<T> {
    return runUnitOfWork(() => this.open(), fn, opts);
  }

  private async open(): Promise<Backend> {
    const c = await this.pool.connect();
    let done = false;
    const release = (destroy = false) => { if (!done) { done = true; c.release(destroy); } };
    const q = async (sql: string, params: unknown[] = []) => {
      try { return await c.query(sql, params); }
      catch (e) {
        const code = (e as { code?: string }).code;
        await c.query("rollback").catch(() => {});
        release();
        if (code && RETRYABLE.has(code)) throw new RetryableConflict(`${code}: ${(e as Error).message}`);
        throw e;
      }
    };
    await q("begin");
    return {
      load: async (coll, key, lock) => (await q(`select doc from ${table(coll)} where key = $1${lock ? " for update" : ""}`, [key])).rows[0]?.doc as Doc | undefined,
      query: async (coll, match, lock) => (await q(`select key, doc from ${table(coll)} where doc @> $1::jsonb order by ord${lock ? " for update" : ""}`, [JSON.stringify(match)])).rows as { key: string; doc: Doc }[],
      queryLog: async (log, match) => (await q(`select idx, doc from ${table(log)} where doc @> $1::jsonb order by idx`, [JSON.stringify(match)])).rows.map((r) => ({ seq: r.idx as number, ...(r.doc as object) })),
      commit: async (ch: Changes) => {
        for (const d of ch.deletes) await q(`delete from ${table(d.coll)} where key = $1`, [d.key]);
        for (const u of ch.updates) await q(`update ${table(u.coll)} set doc = $2::jsonb, updated_at = now() where key = $1`, [u.key, JSON.stringify(u.doc)]);
        for (const i of ch.inserts) await q(`insert into ${table(i.coll)} (key, doc) values ($1, $2::jsonb)`, [i.key, JSON.stringify(i.doc)]);
        for (const u of ch.upserts) await q(`insert into ${table(u.coll)} (key, doc) values ($1, $2::jsonb) on conflict (key) do update set doc = excluded.doc, updated_at = now()`, [u.key, JSON.stringify(u.doc)]);
        for (const a of ch.appends) await q(`insert into ${table(a.log)} (doc) values ($1::jsonb)`, [JSON.stringify(a.doc)]);
        await q("commit");
        release();
      },
      rollback: async () => { if (!done) { await c.query("rollback").catch(() => {}); release(); } },
    };
  }

  async migrate(): Promise<string[]> {
    const c = await this.pool.connect();
    try {
      if (this.opts.schema) await c.query(`create schema if not exists ${pg.escapeIdentifier(this.opts.schema)}`);
      await c.query("select pg_advisory_lock(hashtext('livecoco:migrate'))");
      await c.query("create table if not exists schema_migrations (name text primary key, checksum text not null, applied_at timestamptz not null default now())");
      const applied = new Map((await c.query("select name, checksum from schema_migrations")).rows.map((r) => [r.name as string, r.checksum as string]));
      const ran: string[] = [];
      for (const file of (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort()) {
        const sql = await readFile(join(MIGRATIONS_DIR, file), "utf8");
        const checksum = createHash("sha256").update(sql).digest("hex");
        const prior = applied.get(file);
        if (prior) {
          if (prior !== checksum) throw new Error(`Migration ${file} was modified after being applied`);
          continue;
        }
        await c.query("begin");
        try {
          await c.query(sql);
          await c.query("insert into schema_migrations (name, checksum) values ($1, $2)", [file, checksum]);
          await c.query("commit");
          ran.push(file);
        } catch (e) {
          await c.query("rollback");
          throw e;
        }
      }
      return ran;
    } finally {
      await c.query("select pg_advisory_unlock(hashtext('livecoco:migrate'))").catch(() => {});
      c.release();
    }
  }
}
