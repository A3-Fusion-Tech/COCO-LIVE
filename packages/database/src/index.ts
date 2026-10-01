import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

/**
 * Pilot persistence (ADR-007): every in-memory collection of the application state is stored as
 * JSON rows in one SQLite file shared by the API and worker processes. Each unit of work runs under
 * an exclusive write lock, reloads state another process committed, and writes only changed rows.
 */
export const PERSISTED_COLLECTIONS = {
  users: "map", phoneIndex: "map", sessions: "map", otps: "map", otpRequests: "map", orgs: "map", claims: "map", evidence: "map",
  audit: "array", raw: "map", observations: "map", aggregates: "map", unpublishable: "map", sourceHealth: "map", msp: "array",
  alerts: "map", notifications: "array", queue: "map", lots: "map", requirements: "map", templates: "map", threads: "map",
  offers: "map", deals: "map", disputes: "map", disputeBefore: "map", reputation: "array", reveals: "array", reports: "array", idempotency: "map",
} as const;
export type CollectionName = keyof typeof PERSISTED_COLLECTIONS;
export type PersistedState = Record<CollectionName, Map<string, unknown> | unknown[]>;

const SCHEMA_VERSION = 1;
const rowKey = (collection: string, key: string) => `${collection}\u0000${key}`;
const arrayKey = (i: number) => String(i).padStart(10, "0");

export class SqliteStore {
  readonly db: DatabaseSync;
  /** Last JSON written or read per row, so a save only touches rows that changed. */
  private readonly saved = new Map<string, string>();
  private seenDataVersion = -1;
  rowsWritten = 0;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;");
    this.db.exec(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS state (collection TEXT NOT NULL, key TEXT NOT NULL, json TEXT NOT NULL, PRIMARY KEY (collection, key)) WITHOUT ROWID;`);
  }

  private dataVersion(): number {
    return Number((this.db.prepare("PRAGMA data_version").get() as { data_version: number }).data_version);
  }

  /** First open of an empty database keeps the target's defaults (catalog references) and writes them; later opens load. */
  attach(target: PersistedState): void {
    this.unitOfWork(target, () => undefined);
  }

  load(target: PersistedState): void {
    this.saved.clear();
    for (const [name, kind] of Object.entries(PERSISTED_COLLECTIONS) as [CollectionName, "map" | "array"][]) {
      const rows = this.db.prepare("SELECT key, json FROM state WHERE collection = ? ORDER BY key").all(name) as { key: string; json: string }[];
      if (kind === "map") {
        const m = target[name] as Map<string, unknown>;
        m.clear();
        for (const r of rows) { m.set(r.key, JSON.parse(r.json)); this.saved.set(rowKey(name, r.key), r.json); }
      } else {
        const a = target[name] as unknown[];
        a.length = 0;
        for (const r of rows) { a.push(JSON.parse(r.json)); this.saved.set(rowKey(name, r.key), r.json); }
      }
    }
  }

  save(target: PersistedState): number {
    const upsert = this.db.prepare("INSERT INTO state (collection, key, json) VALUES (?, ?, ?) ON CONFLICT (collection, key) DO UPDATE SET json = excluded.json");
    const remove = this.db.prepare("DELETE FROM state WHERE collection = ? AND key = ?");
    let written = 0;
    const live = new Set<string>();
    for (const [name, kind] of Object.entries(PERSISTED_COLLECTIONS) as [CollectionName, "map" | "array"][]) {
      const entries: [string, unknown][] = kind === "map" ? [...(target[name] as Map<string, unknown>)] : (target[name] as unknown[]).map((v, i) => [arrayKey(i), v]);
      for (const [key, value] of entries) {
        const k = rowKey(name, key);
        live.add(k);
        const json = JSON.stringify(value);
        if (this.saved.get(k) === json) continue;
        upsert.run(name, key, json);
        this.saved.set(k, json);
        written++;
      }
    }
    for (const k of [...this.saved.keys()]) {
      if (live.has(k)) continue;
      const [name, key] = k.split("\u0000") as [string, string];
      remove.run(name, key);
      this.saved.delete(k);
      written++;
    }
    this.rowsWritten += written;
    return written;
  }

  /**
   * Runs `fn` atomically across processes. State changed by `fn` is committed even when it throws,
   * matching the in-memory semantics (for example, failed OTP attempts must stay counted).
   */
  unitOfWork<T>(target: PersistedState, fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const initialized = this.db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get();
      if (!initialized) {
        this.db.prepare("INSERT INTO meta (key, value) VALUES ('schema_version', ?)").run(String(SCHEMA_VERSION));
      } else if (this.dataVersion() !== this.seenDataVersion) {
        this.load(target);
      }
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
    let result: T | undefined, failure: unknown, failed = false;
    try { result = fn(); } catch (e) { failed = true; failure = e; }
    try {
      this.save(target);
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      this.load(target); // memory must match what is durable
      throw e;
    }
    this.seenDataVersion = this.dataVersion();
    if (failed) throw failure;
    return result as T;
  }

  close(): void { this.db.close(); }
}

export const defaultDatabasePath = (env: Record<string, string | undefined> = process.env) => env.LIVECOCO_DB_PATH ?? ".data/livecoco.sqlite";
