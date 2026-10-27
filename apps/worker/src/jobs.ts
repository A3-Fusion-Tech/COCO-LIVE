import type { LiveCoco, OutboxMessage } from "@livecoco/api";
import { AgmarknetAdapter } from "./agmarknet.ts";

export type { OutboxMessage };

/** Where fetched records go. */
export interface IngestSink {
  ingest(source: string, records: Record<string, unknown>[]): Promise<{ stored: number; duplicates: number; observations: number; unmapped: number }>;
  failure(source: string, error: string): Promise<void>;
  tick(): Promise<Record<string, number>>;
}

/** Pull every page, store raw first, then normalise; failures only degrade source health, never erase last-known values. */
export async function runAgmarknetIngest(sink: IngestSink, adapter: AgmarknetAdapter, maxPages = 20) {
  const totals = { stored: 0, duplicates: 0, observations: 0, unmapped: 0, pages: 0 };
  try {
    let offset: number | null = 0;
    while (offset !== null && totals.pages < maxPages) {
      const batch = await adapter.fetch(offset);
      const r = await sink.ingest("agmarknet", batch.records);
      totals.stored += r.stored; totals.duplicates += r.duplicates; totals.observations += r.observations; totals.unmapped += r.unmapped;
      totals.pages++;
      offset = batch.nextOffset;
    }
    return { ok: true as const, ...totals };
  } catch (e) {
    await sink.failure("agmarknet", e instanceof Error ? e.message : "unknown").catch(() => {});
    return { ok: false as const, error: "SOURCE_UNAVAILABLE", ...totals };
  }
}

/** The worker's sink: each call is one unit of work against the shared database. */
export const appSink = (app: LiveCoco): IngestSink => ({
  ingest: (source, records) => app.run(async (s) => {
    const r = await app.services.prices.ingestRaw(s, source, records);
    await app.services.prices.refreshAggregates(s);
    return r;
  }),
  failure: (source, error) => app.run((s) => app.services.prices.recordSourceFailure(s, source, error)),
  tick: () => app.run((s) => app.services.maintenance.tick(s)),
});

// ---- outbox delivery (ADR-004) -------------------------------------------------------------
/** Provider seam: SMS / WhatsApp / push. `console` is for local development; real providers implement the same shape. */
export interface MessageProvider { send(msg: OutboxMessage, body: string): Promise<void> }
export const consoleProvider = (write: (line: string) => void = (l) => void process.stdout.write(l + "\n")): MessageProvider => ({
  async send(msg, body) { write(JSON.stringify({ level: "info", msg: "message (console provider)", to: msg.to ? `***${msg.to.slice(-2)}` : null, channel: msg.channel, body })); },
});
export const disabledProvider: MessageProvider = { async send() { throw new Error("provider disabled"); } };

export interface OutboxClient {
  claim(limit: number): Promise<OutboxMessage[]>;
  ack(notificationId: string, ok: boolean, error?: string): Promise<void>;
}
export const appOutbox = (app: LiveCoco): OutboxClient => ({
  claim: (limit) => app.run((s) => app.services.notifier.claim(s, limit)),
  ack: async (notificationId, ok, error = "") => { await app.run((s) => app.services.notifier.ack(s, notificationId, ok, error)); },
});

export async function deliverOutbox(client: OutboxClient, providers: Record<string, MessageProvider>, render: (m: OutboxMessage) => string, limit = 20) {
  const result = { sent: 0, failed: 0 };
  for (const m of await client.claim(limit)) {
    try {
      const provider = providers[m.channel];
      if (!provider) throw new Error(`no provider for ${m.channel}`);
      if (!m.to) throw new Error("recipient has no phone");
      await provider.send(m, render(m));
      await client.ack(m.notificationId, true);
      result.sent++;
    } catch (e) {
      await client.ack(m.notificationId, false, e instanceof Error ? e.message : "error");
      result.failed++;
    }
  }
  return result;
}
