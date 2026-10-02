import { PgStore } from "./pg.ts";

const cmd = process.argv[2];
const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL is required"); process.exit(1); }
const store = new PgStore({ connectionString: url, requireWriterLock: false });
try {
  if (cmd === "migrate") {
    const ran = await store.migrate();
    console.log(ran.length ? `applied: ${ran.join(", ")}` : "database is up to date");
  } else if (cmd === "reset") {
    // Deterministic local reset: refuses anything that is not an explicit local database.
    const host = new URL(url).hostname;
    if (!["localhost", "127.0.0.1", "::1", "postgres", "db"].includes(host) || process.env.NODE_ENV === "production") {
      console.error(`Refusing to reset non-local database host '${host}'`);
      process.exit(1);
    }
    await store.pool.query("drop schema public cascade; create schema public;");
    console.log("schema reset; applied:", (await store.migrate()).join(", "));
  } else {
    console.error("usage: db.ts migrate|reset");
    process.exit(1);
  }
} finally {
  await store.close();
}
