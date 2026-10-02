import { AgmarknetAdapter } from "./agmarknet.ts";

/** Where fetched records go: in-process (tests) or the API's internal endpoints (production). */
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

/** HTTP sink for the API's `/v1/internal/*` endpoints. */
export class HttpSink implements IngestSink {
  private base: string;
  private token: string;
  private fetchImpl: typeof fetch;
  constructor(base: string, token: string, fetchImpl: typeof fetch = fetch) {
    this.base = base;
    this.token = token;
    this.fetchImpl = fetchImpl;
  }
  rawPost(path: string, body: unknown): Promise<unknown> { return this.post(path, body); }
  private async post<T>(path: string, body: unknown): Promise<T> {
    const res = await this.fetchImpl(`${this.base}/v1/internal/${path}`, { method: "POST", headers: { "content-type": "application/json", "x-internal-token": this.token }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`internal API ${path} failed with ${res.status}`);
    return (await res.json()) as T;
  }
  ingest(source: string, records: Record<string, unknown>[]) { return this.post<{ stored: number; duplicates: number; observations: number; unmapped: number }>("ingest", { source, records }); }
  async failure(source: string, error: string) { await this.post("source-failure", { source, error }); }
  tick() { return this.post<Record<string, number>>("tick", {}); }
}

// ---- outbox delivery (ADR-004) -------------------------------------------------------------
export interface OutboxMessage { notificationId: string; to: string | null; locale: "en" | "ta"; channel: string; template: string; data: Record<string, unknown>; attempt: number }
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
export class HttpOutbox implements OutboxClient {
  private sink: HttpSink;
  constructor(sink: HttpSink) { this.sink = sink; }
  async claim(limit: number) { return ((await this.sink.rawPost("outbox/claim", { limit })) as { items: OutboxMessage[] }).items; }
  async ack(notificationId: string, ok: boolean, error = "") { await this.sink.rawPost("outbox/ack", { notificationId, ok, error }); }
}

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
