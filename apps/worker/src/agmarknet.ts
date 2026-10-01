/** AGMARKNET / data.gov.in adapter: fetch(cursor) → RawBatch, identify(raw) → id, parse(raw) → candidate, checkpoint(result) → cursor. */
export interface RawBatch { records: Record<string, unknown>[]; requestId: string; status: number; nextOffset: number | null }
export interface FetchLike { (url: string, init?: { headers?: Record<string, string> }): Promise<{ status: number; json(): Promise<any> }> }

export interface AgmarknetConfig { apiKey: string; resourceId: string; baseUrl?: string; pageSize?: number; maxRetries?: number; sleep?: (ms: number) => Promise<void>; random?: () => number }

const RELEVANT = /coconut|copra/i;

export class AgmarknetAdapter {
  private cfg: AgmarknetConfig;
  private fetchImpl: FetchLike;
  constructor(cfg: AgmarknetConfig, fetchImpl: FetchLike = fetch as never) {
    this.cfg = cfg;
    this.fetchImpl = fetchImpl;
  }

  /** Credentials go in the URL only for the provider call; they are never returned or logged. */
  async fetch(offset: number): Promise<RawBatch> {
    const size = this.cfg.pageSize ?? 100;
    const url = `${this.cfg.baseUrl ?? "https://api.data.gov.in/resource"}/${this.cfg.resourceId}?api-key=${encodeURIComponent(this.cfg.apiKey)}&format=json&offset=${offset}&limit=${size}&filters%5Bstate.keyword%5D=Tamil%20Nadu`;
    const max = this.cfg.maxRetries ?? 3;
    let lastErr: unknown;
    for (let attempt = 0; attempt <= max; attempt++) {
      try {
        const r = await this.fetchImpl(url);
        if (r.status === 429 || r.status >= 500) throw new Error(`provider status ${r.status}`);
        if (r.status !== 200) throw Object.assign(new Error(`provider status ${r.status}`), { fatal: true });
        const j = await r.json();
        const rows: Record<string, unknown>[] = Array.isArray(j?.records) ? j.records : [];
        // Defensive local filtering in addition to the server-side filter
        const records = rows.filter((x) => String(x.state ?? "Tamil Nadu").toLowerCase() === "tamil nadu" && RELEVANT.test(String(x.commodity ?? "")));
        return { records, requestId: String(j?.index_name ?? `offset-${offset}`), status: r.status, nextOffset: rows.length >= size ? offset + size : null };
      } catch (e) {
        lastErr = e;
        if ((e as { fatal?: boolean }).fatal || attempt === max) break;
        await (this.cfg.sleep ?? ((ms) => new Promise((res) => setTimeout(res, ms))))(Math.min(30_000, 2 ** attempt * 500) * (0.5 + (this.cfg.random ?? Math.random)()));
      }
    }
    throw new Error(String((lastErr as Error)?.message ?? lastErr).replace(/api-key=[^&\s]+/gi, "api-key=[REDACTED]"));
  }

  identify(r: Record<string, unknown>): string {
    return [r.state, r.district, r.market, r.commodity, r.variety, r.grade, r.arrival_date].map((x) => String(x ?? "").trim().toLowerCase()).join("|");
  }
}
