// Seeds a LOCAL database with synthetic development actors (never real data).
// The canonical catalog lives in code (packages/domain/src/catalog.ts); no catalog rows are needed.
import { Platform } from "../apps/api/src/platform.ts";
import { PgStore } from "../packages/database/src/pg.ts";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const host = new URL(url).hostname;
if (!["localhost", "127.0.0.1", "::1", "db", "postgres"].includes(host) || process.env.NODE_ENV === "production") throw new Error(`Refusing to seed non-local database '${host}'`);

const store = new PgStore({ connectionString: url });
await store.migrate();
await store.acquireWriterLock();
const p = new Platform({ operators: { "+919000000001": ["ops.price_review", "ops.source_health", "ops.verification", "ops.listings", "ops.disputes", "ops.audit"] } });
await store.load(p);
await store.withTransaction(p, () => {
  if (p.users.size) return;
  for (const x of [{ phone: "+919000000001", name: "Dev Operator" }, { phone: "+919000000002", name: "Dev Farmer" }, { phone: "+919000000003", name: "Dev Buyer" }]) {
    const u = { userId: `user_seed_${x.phone.slice(-2)}`, phone: x.phone, displayName: x.name, actingAs: "INDEPENDENT", organizationIds: [], capabilities: p.cfg.operators[x.phone] ?? [], suspended: false, blocked: [], locale: "ta", createdAt: p.iso() };
    p.users.set(u.userId, u);
  }
});
console.log(`seeded ${p.users.size} synthetic development users`);
await store.close();
