// Seeds a LOCAL database with synthetic development actors (never real data).
// The canonical catalog lives in code (packages/domain/src/catalog.ts); no catalog rows are needed.
import { Collections } from "@livecoco/api";
import { PgStore } from "@livecoco/database";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const host = new URL(url).hostname;
if (!["localhost", "127.0.0.1", "::1", "db", "postgres"].includes(host) || process.env.NODE_ENV === "production") throw new Error(`Refusing to seed non-local database '${host}'`);

const OPS = ["ops.price_review", "ops.source_health", "ops.verification", "ops.listings", "ops.disputes", "ops.audit"];
const store = new PgStore({ connectionString: url, poolSize: 1 });
await store.migrate();
const created = await store.run(async (tx) => {
  let n = 0;
  for (const x of [{ phone: "+919000000001", name: "Dev Operator", ops: true }, { phone: "+919000000002", name: "Dev Farmer" }, { phone: "+919000000003", name: "Dev Buyer" }]) {
    if ((await tx.find(Collections.users, { phone: x.phone })).length) continue;
    const userId = `user_seed_${x.phone.slice(-2)}`;
    tx.put(Collections.users, userId, { userId, phone: x.phone, displayName: x.name, actingAs: "INDEPENDENT", organizationIds: [], capabilities: x.ops ? OPS : [], suspended: false, blocked: [], locale: "ta", createdAt: new Date().toISOString() });
    n++;
  }
  return n;
});
console.log(`seeded ${created} synthetic development users`);
await store.close();
