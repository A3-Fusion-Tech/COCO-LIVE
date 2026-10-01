import { Platform } from "../../api/src/platform.ts";
import { AgmarknetAdapter } from "./agmarknet.ts";

/** Pull every page, store raw first, then normalise; failures only degrade source health, never erase last-known values. */
export async function runAgmarknetIngest(p: Platform, adapter: AgmarknetAdapter, maxPages = 20) {
  const totals = { stored: 0, duplicates: 0, observations: 0, unmapped: 0, pages: 0 };
  try {
    let offset: number | null = 0;
    while (offset !== null && totals.pages < maxPages) {
      const batch = await adapter.fetch(offset);
      const r = p.ingestRaw("agmarknet", batch.records);
      totals.stored += r.stored; totals.duplicates += r.duplicates; totals.observations += r.observations; totals.unmapped += r.unmapped;
      totals.pages++;
      offset = batch.nextOffset;
    }
    p.refreshAggregates();
    return { ok: true as const, ...totals };
  } catch (e) {
    p.recordSourceFailure("agmarknet", e instanceof Error ? e.message : "unknown");
    return { ok: false as const, error: "SOURCE_UNAVAILABLE", ...totals };
  }
}

/** One scheduler tick; every step is idempotent so overlapping or repeated ticks are safe. */
export function runMaintenanceTick(p: Platform) {
  const expiry = p.runExpiry();
  const aggregatesChanged = p.refreshAggregates();
  const alertsSent = p.evaluateAlerts();
  return { ...expiry, aggregatesChanged, alertsSent };
}
