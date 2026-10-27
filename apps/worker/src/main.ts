import { FsBlobStore, LiveCoco } from "@livecoco/api";
import { PgStore } from "@livecoco/database";
import { renderNotification } from "@livecoco/localization";
import { createLogger } from "@livecoco/observability";
import { AgmarknetAdapter } from "./agmarknet.ts";
import { appOutbox, appSink, consoleProvider, deliverOutbox, disabledProvider, runAgmarknetIngest, type MessageProvider } from "./jobs.ts";

/**
 * Background worker: official price ingestion, the maintenance tick (expiry, aggregation, alerts), housekeeping
 * (retention, upload scanning) and outbox delivery. It works directly on the shared Postgres database, so any
 * number of workers and API processes can run side by side.
 */
const log = createLogger();
const env = process.env;
if (!env.DATABASE_URL) { log.error("DATABASE_URL is required"); process.exit(1); }
const store = new PgStore({ connectionString: env.DATABASE_URL, poolSize: 3 });
await store.migrate();
const app = new LiveCoco({ blobs: new FsBlobStore(env.OBJECT_STORAGE_DIR ?? "./.data/objects") }, store);
const sink = appSink(app);
const adapter = env.DATA_GOV_IN_API_KEY ? new AgmarknetAdapter({ apiKey: env.DATA_GOV_IN_API_KEY, resourceId: env.AGMARKNET_RESOURCE_ID ?? "9ef84268-d588-465a-a308-a864a43d0070" }) : undefined;

const pick = (name: string | undefined): MessageProvider => ((name ?? "console") === "console" && env.NODE_ENV !== "production" ? consoleProvider() : disabledProvider);
const providers = { SMS: pick(env.SMS_PROVIDER), WHATSAPP: pick(env.WHATSAPP_PROVIDER === "disabled" ? "none" : env.WHATSAPP_PROVIDER), PUSH: disabledProvider };
const outbox = appOutbox(app);

async function tick() {
  try {
    if (adapter) log.info("ingest", await runAgmarknetIngest(sink, adapter));
    else log.warn("DATA_GOV_IN_API_KEY not set; skipping official ingestion");
    log.info("maintenance", await sink.tick());
    log.info("housekeeping", await app.run((s) => app.services.maintenance.housekeeping(s)));
    log.info("outbox", await deliverOutbox(outbox, providers, (m) => renderNotification(m.locale, m.template, m.data)));
  } catch (e) {
    log.error("tick failed", { err: e instanceof Error ? e.message : "unknown" });
  }
}
await tick();
const timer = setInterval(() => void tick(), Number(env.WORKER_INTERVAL_MS ?? 15 * 60_000));
for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => { clearInterval(timer); void store.close().then(() => process.exit(0)); });
