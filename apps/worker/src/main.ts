import { Platform } from "../../api/src/platform.ts";
import { AgmarknetAdapter } from "./agmarknet.ts";
import { runAgmarknetIngest, runMaintenanceTick } from "./jobs.ts";
import { createLogger } from "../../../packages/observability/src/index.ts";

const log = createLogger();
const platform = new Platform();
const key = process.env.DATA_GOV_IN_API_KEY;
const adapter = key ? new AgmarknetAdapter({ apiKey: key, resourceId: process.env.AGMARKNET_RESOURCE_ID ?? "9ef84268-d588-465a-a308-a864a43d0070" }) : undefined;

async function tick() {
  if (adapter) log.info("ingest", await runAgmarknetIngest(platform, adapter));
  else log.warn("DATA_GOV_IN_API_KEY not set; skipping official ingestion");
  log.info("maintenance", runMaintenanceTick(platform));
}
await tick();
setInterval(() => void tick(), Number(process.env.WORKER_INTERVAL_MS ?? 15 * 60_000));
