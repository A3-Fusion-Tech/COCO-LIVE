import { MemoryStore, PgStore, type Store } from "@livecoco/database";
import { createLogger } from "@livecoco/observability";
import { LiveCoco } from "./app.ts";
import { createApp } from "./server.ts";
import { FsBlobStore } from "./modules/media/media.service.ts";
import type { Capability } from "./modules/identity/identity.types.ts";

const logger = createLogger();
const env = process.env;
const prod = env.NODE_ENV === "production";
const port = Number(env.PORT ?? 4000);
const fail = (msg: string) => { logger.error(msg); process.exit(1); };

if (prod && !env.UPLOAD_SIGNING_SECRET) fail("UPLOAD_SIGNING_SECRET is required in production");
if (prod && !env.DATABASE_URL) fail("DATABASE_URL is required in production");

const caps: Capability[] = ["ops.price_review", "ops.source_health", "ops.verification", "ops.listings", "ops.disputes", "ops.audit"];
const operators = Object.fromEntries((env.OPERATOR_PHONES ?? "").split(",").filter(Boolean).map((p) => [p.trim(), caps]));

let store: Store;
if (env.DATABASE_URL) {
  const pg = new PgStore({ connectionString: env.DATABASE_URL });
  try { await pg.migrate(); } catch (e) { fail(`migration failed: ${e instanceof Error ? e.message : "unknown"}`); }
  store = pg;
  logger.info("postgres connected");
} else {
  store = new MemoryStore();
  logger.warn("DATABASE_URL not set: running with volatile in-memory state");
}

const app = new LiveCoco({
  operators,
  // Console OTP provider: local development only, never in production.
  deliverOtp: (phone, code) => { if (!prod && (env.OTP_PROVIDER ?? "console") === "console") console.log(`[dev-otp] ${phone}: ${code}`); },
  blobs: new FsBlobStore(env.OBJECT_STORAGE_DIR ?? "./.data/objects"),
  baseUrl: env.API_BASE_URL ?? `http://localhost:${port}`,
  ...(env.UPLOAD_SIGNING_SECRET ? { uploadSecret: env.UPLOAD_SIGNING_SECRET } : {}),
}, store);

const server = await createApp({ app, logger, trustProxy: env.TRUST_PROXY === "1" });
server.listen(port, () => logger.info("api listening", { port }));
for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => server.close(() => void store.close().then(() => process.exit(0))));
