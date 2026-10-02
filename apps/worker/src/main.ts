import { AgmarknetAdapter } from "./agmarknet.ts";
import { HttpOutbox, HttpSink, consoleProvider, deliverOutbox, disabledProvider, runAgmarknetIngest, type MessageProvider } from "./jobs.ts";
import { renderNotification } from "../../../packages/localization/src/index.ts";
import { createLogger } from "../../../packages/observability/src/index.ts";

const log = createLogger();
const token = process.env.INTERNAL_API_TOKEN;
if (!token) { log.error("INTERNAL_API_TOKEN is required"); process.exit(1); }
const sink = new HttpSink(process.env.API_BASE_URL ?? "http://localhost:4000", token);
const key = process.env.DATA_GOV_IN_API_KEY;
const adapter = key ? new AgmarknetAdapter({ apiKey: key, resourceId: process.env.AGMARKNET_RESOURCE_ID ?? "9ef84268-d588-465a-a308-a864a43d0070" }) : undefined;

const pick = (name: string | undefined): MessageProvider => ((name ?? "console") === "console" && process.env.NODE_ENV !== "production" ? consoleProvider() : disabledProvider);
const providers = { SMS: pick(process.env.SMS_PROVIDER), WHATSAPP: pick(process.env.WHATSAPP_PROVIDER === "disabled" ? "none" : process.env.WHATSAPP_PROVIDER), PUSH: disabledProvider };
const outbox = new HttpOutbox(sink);

async function tick() {
  try {
    if (adapter) log.info("ingest", await runAgmarknetIngest(sink, adapter));
    else log.warn("DATA_GOV_IN_API_KEY not set; skipping official ingestion");
    log.info("maintenance", await sink.tick());
    log.info("outbox", await deliverOutbox(outbox, providers, (m) => renderNotification(m.locale, m.template, m.data)));
  } catch (e) {
    log.error("tick failed", { err: e instanceof Error ? e.message : "unknown" });
  }
}
await tick();
setInterval(() => void tick(), Number(process.env.WORKER_INTERVAL_MS ?? 15 * 60_000));
