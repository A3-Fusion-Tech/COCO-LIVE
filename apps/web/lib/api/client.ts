import { ApiError, problemFromResponse, unavailable } from "./errors.ts";
import type {
  Alert, AuditEntry, BuyRequirement, Catalog, Deal, Dispute, Inspection, LatestPrices, List, MarketLot, MatchCandidate, Me, MemberLot,
  MspItem, Offer, OrganizationMembership, Page, Partner, PartnerListing, PartnerSla, PriceEvidence, QueueItem, SellLot, SourceHealth,
  TransportQuote, TransportRequest,
} from "./types.ts";

export interface ApiClientOptions {
  /** API origin without a trailing slash, e.g. `http://localhost:4000`. */
  baseUrl: string;
  /** Session token from the `lc_session` cookie; sent as `Authorization: Bearer`. Server-side only. */
  token?: string | undefined;
  /** Sent as `accept-language` so API problem messages come back in the UI language. */
  locale?: string | undefined;
  /** Client address for the API's per-IP limits; only set when it comes from a trusted proxy (see `clientIp`). */
  clientIp?: string | undefined;
  fetchImpl?: typeof fetch;
}

/** Next.js's `fetch` extension for the data cache; ignored by plain `fetch`. */
export interface CacheHint { revalidate?: number | false; tags?: string[] }
export interface SendOptions { idempotencyKey?: string }

type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

/**
 * Typed client for the `/v1` API. Framework-free (server components, server actions and tests construct it);
 * every failure surfaces as an `ApiError` carrying the API's problem details, or 503 `UNAVAILABLE` when the API
 * cannot be reached. Authenticated reads are never cached; public reads may pass a `CacheHint`.
 */
export class ApiClient {
  readonly options: ApiClientOptions;
  constructor(options: ApiClientOptions) { this.options = { ...options, baseUrl: options.baseUrl.replace(/\/$/, "") }; }

  async request<T>(method: Method, path: string, init: { body?: unknown; idempotencyKey?: string; cache?: CacheHint } = {}): Promise<T> {
    const o = this.options;
    const headers: Record<string, string> = { accept: "application/json" };
    if (o.locale) headers["accept-language"] = o.locale;
    if (o.token) headers.authorization = `Bearer ${o.token}`;
    if (o.clientIp) headers["x-forwarded-for"] = o.clientIp;
    if (init.body !== undefined) headers["content-type"] = "application/json";
    // Every mutation carries a key: the API rejects unkeyed requests on idempotent routes and replays keyed ones.
    if (method !== "GET") headers["idempotency-key"] = init.idempotencyKey ?? crypto.randomUUID();
    const cacheInit = method === "GET" && init.cache && !o.token ? { next: init.cache } : { cache: "no-store" as const };
    let res: Response;
    try {
      res = await (o.fetchImpl ?? fetch)(o.baseUrl + path, { method, headers, redirect: "manual", ...cacheInit, ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}) });
    } catch {
      throw unavailable();
    }
    if (!res.ok) throw new ApiError(await problemFromResponse(res));
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  get<T>(path: string, cache?: CacheHint) { return this.request<T>("GET", path, cache ? { cache } : {}); }
  post<T = unknown>(path: string, body: unknown = {}, opts: SendOptions = {}) { return this.request<T>("POST", path, { body, ...opts }); }
  patch<T = unknown>(path: string, body: unknown, opts: SendOptions = {}) { return this.request<T>("PATCH", path, { body, ...opts }); }

  // ---- typed reads --------------------------------------------------------------
  catalog(cache?: CacheHint) { return this.get<Catalog>("/v1/catalog", cache); }
  latestPrices(cache?: CacheHint) { return this.get<LatestPrices>("/v1/prices/latest", cache); }
  msp(cache?: CacheHint) { return this.get<List<MspItem>>("/v1/prices/msp", cache); }
  priceEvidence(q: { productId: string; marketId: string; unit: string; stage: string }) { return this.get<PriceEvidence>(`/v1/prices/evidence?${new URLSearchParams(q)}`); }
  marketLots(cursor?: string | null) { return this.get<Page<MarketLot>>(`/v1/sell-lots?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`); }

  me() { return this.get<Me>("/v1/me"); }
  myOrganizations() { return this.get<List<OrganizationMembership>>("/v1/me/organizations"); }
  alerts() { return this.get<List<Alert>>("/v1/alerts"); }
  mySellLots() { return this.get<List<SellLot>>("/v1/me/sell-lots"); }
  sellLotMatches(id: string) { return this.get<List<MatchCandidate>>(`/v1/sell-lots/${enc(id)}/matches`); }
  myBuyRequirements() { return this.get<List<BuyRequirement>>("/v1/me/buy-requirements"); }
  requirementMatches(id: string) { return this.get<List<MatchCandidate>>(`/v1/buy-requirements/${enc(id)}/matches`); }
  offers() { return this.get<List<Offer>>("/v1/offers"); }
  deals() { return this.get<List<Deal>>("/v1/deals"); }
  deal(id: string) { return this.get<Deal>(`/v1/deals/${enc(id)}`); }
  dealInspections(id: string) { return this.get<List<Inspection>>(`/v1/deals/${enc(id)}/inspections`); }
  dispute(id: string) { return this.get<Dispute>(`/v1/disputes/${enc(id)}`); }
  transportRequest(id: string) { return this.get<TransportRequest>(`/v1/transport-requests/${enc(id)}`); }
  transportQuotes(requestId: string) { return this.get<List<TransportQuote>>(`/v1/transport-requests/${enc(requestId)}/quotes`); }
  partners(kind: "INSPECTION" | "LOGISTICS") { return this.get<List<PartnerListing>>(`/v1/partners?kind=${kind}`); }
  myPartners() { return this.get<List<Partner>>("/v1/me/partners"); }
  partnerSla(id: string) { return this.get<PartnerSla>(`/v1/partners/${enc(id)}/sla`); }
  partnerInspections() { return this.get<List<Inspection>>("/v1/partner/inspections"); }
  partnerTransportRequests() { return this.get<List<TransportRequest>>("/v1/partner/transport-requests"); }
  partnerTransportJobs() { return this.get<List<TransportRequest>>("/v1/partner/transport-jobs"); }
  memberLots(orgId: string) { return this.get<List<MemberLot>>(`/v1/organizations/${enc(orgId)}/member-lots`); }
  opsQueues() { return this.get<List<QueueItem>>("/v1/ops/queues"); }
  opsSourceHealth() { return this.get<List<SourceHealth>>("/v1/ops/source-health"); }
  opsAudit() { return this.get<List<AuditEntry>>("/v1/ops/audit"); }
}

/** Path segments from URLs and forms are always encoded, so an id cannot change the route it is sent to. */
export const enc = (segment: string) => encodeURIComponent(segment);
