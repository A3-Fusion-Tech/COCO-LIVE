import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import type { TrackedMap } from "./tracked.ts";

/** Application state that persists: tracked key/value tables plus append-only logs. */
export interface Persistable {
  readonly tables: Map<string, TrackedMap<any>>;
  readonly logs: Record<string, unknown[]>;
  rehydrate(): void;
}

/** Logical collection name → physical table. */
export const TABLES: Record<string, string> = {
  users: "users", sessions: "sessions", otps: "otps", otpRequests: "otp_requests", orgs: "organizations", claims: "verification_claims",
  evidence: "evidence", raw: "raw_records", observations: "price_observations", aggregates: "price_aggregates", sourceHealth: "source_health",
  alerts: "alert_subscriptions", queue: "ops_queue", lots: "sell_lots", requirements: "buy_requirements", templates: "recurrence_templates",
  threads: "negotiation_threads", offers: "offers", deals: "deals", disputes: "disputes", disputeBefore: "dispute_prior_status", idempotency: "idempotency_keys",
  partners: "partners", inspections: "inspections", transportRequests: "transport_requests", transportQuotes: "transport_quotes",
  memberLots: "member_lots", aggregateLots: "aggregate_lots", settlements: "settlements", media: "media", outbox: "outbox",
};
export const LOGS: Record<string, string> = {
  audit: "audit_log", notifications: "notifications", reputation: "reputation_events", reveals: "contact_reveals", reports: "user_reports",
};

/** Key-order-independent JSON (jsonb does not preserve key order). */
export function canon(v: unknown): string {
  return JSON.stringify(v, (_k, val) => (val && typeof val === "object" && !Array.isArray(val) ? Object.fromEntries(Object.entries(val).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : val));
}

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");
const LOCK_NAMESPACE = "livecoco:writer:";

export interface PgOptions {
  connectionString: string;
  /** Isolated schema (used by tests). Created if missing. */
  schema?: string;
  /** Refuse to start if another process already holds the writer lock (default true). */
  requireWriterLock?: boolean;
}

/**
 * Postgres-backed unit of work.
 *
 * Model: the process loads the database into its in-memory aggregates at startup, serves every
 * request inside `withTransaction` (serialised by a mutex), and writes only the entities that
 * actually changed in one SQL transaction. If a request fails after partially mutating memory, the
 * touched entities are reloaded from the database, so memory never diverges from committed state.
 * One process holds a session-level advisory lock so there is exactly one writer.
 */
export class PgStore {
  readonly pool: pg.Pool;
  private lockClient: pg.PoolClient | undefined;
  private persisted = new Map<string, Map<string, string>>();
  private logMarks = new Map<string, number>();
  private chain: Promise<unknown> = Promise.resolve();
  private opts: PgOptions;

  constructor(opts: PgOptions) {
    this.opts = opts;
    this.pool = new pg.Pool({ connectionString: opts.connectionString, max: 5, ...(opts.schema ? { options: `-c search_path=${opts.schema}` } : {}) });
  }

  async close() {
    if (this.lockClient) { this.lockClient.release(true); this.lockClient = undefined; }
    await this.pool.end();
  }

  // ---- migrations ---------------------------------------------------------
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

  // ---- writer lock --------------------------------------------------------
  async acquireWriterLock(): Promise<void> {
    if (this.opts.requireWriterLock === false) return;
    const c = await this.pool.connect();
    const res = await c.query("select pg_try_advisory_lock(hashtext($1 || current_schema())) as ok", [LOCK_NAMESPACE]);
    if (!res.rows[0].ok) { c.release(); throw new Error("Another LiveCoco process already holds the writer lock for this database"); }
    this.lockClient = c; // keep the session open for the lifetime of the process
  }

  // ---- load ---------------------------------------------------------------
  async load(app: Persistable): Promise<void> {
    for (const [name, table] of app.tables) {
      const phys = TABLES[name] as string;
      table.clear();
      const rows = (await this.pool.query(`select key, doc from ${phys}`)).rows as { key: string; doc: unknown }[];
      const snap = new Map<string, string>();
      for (const r of rows) { table.hydrate(r.key, r.doc as never); snap.set(r.key, canon(r.doc)); }
      this.persisted.set(name, snap);
    }
    for (const [name, log] of Object.entries(app.logs)) {
      log.length = 0;
      const rows = (await this.pool.query(`select doc from ${LOGS[name]} order by idx`)).rows as { doc: unknown }[];
      for (const r of rows) log.push(r.doc);
      this.logMarks.set(name, log.length);
    }
    app.rehydrate();
  }

  // ---- unit of work -------------------------------------------------------
  /** Runs `fn` exclusively; commits changed entities, or restores memory from the database on failure. */
  withTransaction<T>(app: Persistable, fn: () => T | Promise<T>, opts: { readOnly?: boolean } = {}): Promise<T> {
    const run = async (): Promise<T> => {
      for (const t of app.tables.values()) t.resetTracking();
      let result: T;
      try {
        result = await fn();
      } catch (e) {
        if ((e as { persistState?: boolean } | null)?.persistState === true) {
          try { await this.flush(app, opts.readOnly); } catch { await this.restore(app); }
        } else await this.restore(app);
        throw e;
      }
      try {
        await this.flush(app, opts.readOnly);
      } catch (e) {
        await this.restore(app);
        throw e;
      }
      return result;
    };
    const next = this.chain.then(run, run);
    this.chain = next.catch(() => {});
    return next;
  }

  /** `logsOnly` (read requests) skips the entity diff and only appends log rows such as audit entries. */
  private async flush(app: Persistable, logsOnly = false) {
    type Op = { sql: string; params: unknown[] };
    const deletes: Op[] = [], updates: Op[] = [], inserts: Op[] = [];
    const nextSnap: [string, string, string | null][] = [];
    for (const [name, table] of logsOnly ? [] : app.tables) {
      const phys = TABLES[name] as string;
      const snap = this.persisted.get(name) as Map<string, string>;
      for (const key of table.candidates()) {
        const present = table.has(key);
        const old = snap.get(key);
        if (!present) {
          if (old !== undefined) { deletes.push({ sql: `delete from ${phys} where key = $1`, params: [key] }); nextSnap.push([name, key, null]); }
          continue;
        }
        const json = canon(Map.prototype.get.call(table, key));
        if (json === old) continue;
        if (old === undefined) inserts.push({ sql: `insert into ${phys} (key, doc) values ($1, $2::jsonb)`, params: [key, json] });
        else updates.push({ sql: `update ${phys} set doc = $2::jsonb, updated_at = now() where key = $1`, params: [key, json] });
        nextSnap.push([name, key, json]);
      }
    }
    const logOps: Op[] = [];
    const nextMarks: [string, number][] = [];
    for (const [name, log] of Object.entries(app.logs)) {
      const from = this.logMarks.get(name) ?? 0;
      for (let i = from; i < log.length; i++) logOps.push({ sql: `insert into ${LOGS[name]} (idx, doc) values ($1, $2::jsonb)`, params: [i, canon(log[i])] });
      nextMarks.push([name, log.length]);
    }
    const ops = [...deletes, ...updates, ...inserts, ...logOps];
    if (!ops.length) return;
    const c = await this.pool.connect();
    try {
      await c.query("begin");
      for (const op of ops) await c.query(op.sql, op.params);
      await c.query("commit");
    } catch (e) {
      await c.query("rollback").catch(() => {});
      throw e;
    } finally {
      c.release();
    }
    for (const [name, key, json] of nextSnap) { const s = this.persisted.get(name) as Map<string, string>; if (json === null) s.delete(key); else s.set(key, json); }
    for (const [name, n] of nextMarks) this.logMarks.set(name, n);
    for (const t of app.tables.values()) t.resetTracking();
  }

  /** Put every entity the failed request touched back to its committed state. */
  private async restore(app: Persistable) {
    for (const [name, table] of app.tables) {
      const keys = table.candidates();
      if (!keys.length) continue;
      const phys = TABLES[name] as string;
      const snap = this.persisted.get(name) as Map<string, string>;
      for (const key of keys) {
        const json = snap.get(key);
        if (json === undefined) table.delete(key);
        else table.set(key, JSON.parse(json));
      }
      // restoring must not look like new writes
      for (const key of keys) { if (snap.has(key)) Map.prototype.set.call(table, key, JSON.parse(snap.get(key) as string)); }
      void phys;
      table.resetTracking();
    }
    for (const [name, log] of Object.entries(app.logs)) log.length = this.logMarks.get(name) ?? 0;
    app.rehydrate();
  }
}
