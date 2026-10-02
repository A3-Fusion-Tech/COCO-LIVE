import { Platform, type Capability } from "./platform.ts";
import { FsBlobStore } from "./fulfilment.ts";
import { createApp } from "./server.ts";
import { PgStore } from "../../../packages/database/src/pg.ts";
import { createLogger } from "../../../packages/observability/src/index.ts";

const logger = createLogger();
const port = Number(process.env.PORT ?? 4000);
const caps: Capability[] = ["ops.price_review", "ops.source_health", "ops.verification", "ops.listings", "ops.disputes", "ops.audit"];
const operators = Object.fromEntries((process.env.OPERATOR_PHONES ?? "").split(",").filter(Boolean).map((p) => [p.trim(), caps]));
const platform = new Platform({
  operators,
  deliverOtp: (phone, code) => {
    // Console provider: local development only. Never enabled when NODE_ENV=production.
    if (process.env.NODE_ENV !== "production" && (process.env.OTP_PROVIDER ?? "console") === "console") console.log(`[dev-otp] ${phone}: ${code}`);
  },
});

const prod = process.env.NODE_ENV === "production";
if (prod && (!process.env.UPLOAD_SIGNING_SECRET || !process.env.INTERNAL_API_TOKEN)) { logger.error("UPLOAD_SIGNING_SECRET and INTERNAL_API_TOKEN are required in production"); process.exit(1); }
if (process.env.UPLOAD_SIGNING_SECRET) platform.fx.uploadSecret = process.env.UPLOAD_SIGNING_SECRET;
platform.fx.baseUrl = process.env.API_BASE_URL ?? `http://localhost:${port}`;
platform.fx.blobs = new FsBlobStore(process.env.OBJECT_STORAGE_DIR ?? "./.data/objects");

let store: PgStore | undefined;
if (process.env.DATABASE_URL) {
  store = new PgStore({ connectionString: process.env.DATABASE_URL });
  try {
    await store.migrate();
    await store.acquireWriterLock();
    await store.load(platform);
  } catch (e) {
    logger.error("startup failed", { reason: e instanceof Error ? e.message : "unknown" });
    process.exit(1);
  }
  logger.info("postgres connected", { users: platform.users.size, lots: platform.lots.size });
} else if (process.env.NODE_ENV === "production") {
  logger.error("DATABASE_URL is required in production");
  process.exit(1);
} else {
  logger.warn("DATABASE_URL not set: running with volatile in-memory state");
}

const server = createApp({ platform, logger, trustProxy: process.env.TRUST_PROXY === "1", ...(store ? { store } : {}), ...(process.env.INTERNAL_API_TOKEN ? { internalToken: process.env.INTERNAL_API_TOKEN } : {}) });
server.listen(port, () => logger.info("api listening", { port }));
for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => server.close(() => void (store?.close() ?? Promise.resolve()).then(() => process.exit(0))));
