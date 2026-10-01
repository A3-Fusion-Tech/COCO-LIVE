import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { DomainError } from "../../../packages/domain/src/index.ts";
import { check, is, paginate, problem, type FieldError, type Shape } from "../../../packages/contracts/src/index.ts";
import { createLogger, newCorrelationId, Metrics, type Logger } from "../../../packages/observability/src/index.ts";
import { parseLocale, t, type Locale } from "../../../packages/localization/src/index.ts";
import { Platform, type Session, type User } from "./platform.ts";

interface Ctx {
  p: Platform;
  body: Record<string, any>;
  params: Record<string, string>;
  query: URLSearchParams;
  user: User;
  session: Session;
  locale: Locale;
  idemKey: string | undefined;
  ifMatch: number | undefined;
}
type Handler = (c: Ctx) => unknown | { status: number; body: unknown };
interface Route { method: string; re: RegExp; keys: string[]; auth: boolean; shape?: Shape; idem: boolean; h: Handler }

const routes: Route[] = [];
function route(method: string, path: string, opts: { auth?: boolean; shape?: Shape; idem?: boolean }, h: Handler) {
  const keys: string[] = [];
  const re = new RegExp("^/v1" + path.replace(/:(\w+)/g, (_m, k: string) => (keys.push(k), "([^/]+)")) + "$");
  routes.push({ method, re, keys, auth: opts.auth ?? true, ...(opts.shape ? { shape: opts.shape } : {}), idem: opts.idem ?? false, h });
}
const created = (body: unknown) => ({ status: 201, body });
const money = (v: unknown) => Number.isSafeInteger(v) && (v as number) >= 0;
const termsShape: Shape = { terms: is.object, expiresAt: is.iso };

// ---- public ----
route("GET", "/prices/latest", { auth: false }, ({ p, query }) => ({ items: p.latestPrices(Object.fromEntries(["productId", "marketId", "stage", "unit", "gradeGroup"].filter((k) => query.get(k)).map((k) => [k, query.get(k)]))), disclaimerKey: "price.not_offer" }));
route("GET", "/prices/evidence", { auth: false }, ({ p, query }) => p.priceEvidence(query.get("productId") ?? "", query.get("marketId") ?? "", query.get("unit") ?? "", query.get("stage") ?? ""));
route("GET", "/prices/history", { auth: false }, ({ p, query }) => ({ items: p.priceHistory(query.get("productId") ?? "", query.get("marketId") ?? "", query.get("unit") ?? "", query.get("stage") ?? "") }));
route("GET", "/prices/msp", { auth: false }, ({ p }) => ({ items: p.mspReferences() }));
route("GET", "/sell-lots", { auth: false }, ({ p, query }) => {
  const all = p.searchLots({ ...(query.get("productId") ? { productId: query.get("productId") as string } : {}), ...(query.get("originMarketId") ? { originMarketId: query.get("originMarketId") as string } : {}), ...(query.get("gradeGroup") ? { gradeGroup: query.get("gradeGroup") as string } : {}) });
  return paginate(all, query.get("cursor"), Math.min(Number(query.get("limit") ?? 20) || 20, 50), (l) => `${l.createdAt}|${l.sellLotId}`);
});

// ---- auth ----
route("POST", "/auth/otp/request", { auth: false, shape: { phone: is.string } }, ({ p, body, query }) => p.requestOtp(body.phone, query.get("device") ?? "web"));
route("POST", "/auth/otp/verify", { auth: false, shape: { phone: is.string, code: is.string } }, ({ p, body }) => {
  const { token, user } = p.verifyOtp(body.phone, body.code, body.device ?? "web");
  return { token, user: { userId: user.userId, capabilities: user.capabilities, locale: user.locale } };
});
route("POST", "/auth/step-up", { shape: { code: is.string } }, ({ p, user, session, body }) => (p.stepUp(session, user, body.code), { ok: true }));
route("GET", "/me", {}, ({ user, p }) => ({ userId: user.userId, displayName: user.displayName, actingAs: user.actingAs, organizationIds: user.organizationIds, capabilities: user.capabilities, locale: user.locale, claims: p.claimSummaries(user.userId) }));
route("PATCH", "/me", {}, ({ p, user, body }) => p.updateProfile(user, { ...(body.displayName ? { displayName: String(body.displayName) } : {}), ...(body.actingAs ? { actingAs: body.actingAs } : {}), ...(body.locale ? { locale: body.locale } : {}) }) && { ok: true });
route("GET", "/me/sessions", {}, ({ p, user }) => ({ items: p.listSessions(user.userId) }));
route("POST", "/me/sessions/revoke-all", {}, ({ p, user }) => (p.revokeAllSessions(user.userId), { ok: true }));
route("POST", "/organizations", { shape: { name: is.string, kind: is.oneOf("FARMER_GROUP", "FPO", "TRADER", "PROCESSOR", "BUYER") }, idem: true }, ({ p, user, body }) => created(p.createOrganization(user, body.name, body.kind)));
route("POST", "/organizations/:id/members", { shape: { userId: is.string, role: is.oneOf("OWNER", "MEMBER", "FINANCE", "VERIFIER") } }, ({ p, user, session, params, body }) => p.addMember(user, params.id as string, body.userId, body.role, session));
route("POST", "/claims", { shape: { type: is.string, scope: is.object, evidence: is.stringArray }, idem: true }, ({ p, user, body }) => created(p.submitClaim(user, body.type, body.scope, body.evidence)));
route("GET", "/me/claims", {}, ({ p, user }) => ({ items: p.claimSummaries(user.userId) }));

// ---- alerts ----
const alertShape: Shape = { productId: is.string, marketId: is.string, unit: is.string, stage: is.string, direction: is.oneOf("ABOVE", "BELOW", "BULLETIN"), channel: is.oneOf("SMS", "WHATSAPP", "PUSH"), consent: is.bool };
route("POST", "/alerts", { shape: alertShape, idem: true }, ({ p, user, body }) => created(p.createAlert(user, body as never)));
route("GET", "/alerts", {}, ({ p, user }) => ({ items: [...p.alerts.values()].filter((a) => a.userId === user.userId) }));
route("PATCH", "/alerts/:id", { shape: { status: is.oneOf("ACTIVE", "PAUSED", "CANCELLED") } }, ({ p, user, params, body }) => p.setAlertStatus(user, params.id as string, body.status));

// ---- contributors ----
route("POST", "/contributor/quotes", { shape: { productId: is.string, marketId: is.string, gradeGroup: is.string, unit: is.string, stage: is.string, tradeTerm: is.string, lowPaise: money, highPaise: money, observedAt: is.iso, organizationId: is.string }, idem: true }, ({ p, user, body }) => created(p.submitQuote(user, body as never)));
route("POST", "/contributor/observations/:id/correction", { shape: { lowPaise: money, highPaise: money, reason: is.string }, idem: true }, ({ p, user, session, params, body }) => p.correctObservation(user, session, params.id as string, { lowPaise: body.lowPaise, highPaise: body.highPaise, ...(body.referencePaise !== undefined ? { referencePaise: body.referencePaise } : {}) }, body.reason));

// ---- sell lots ----
route("POST", "/sell-lots", { shape: { productId: is.string, gradeAttributes: is.object, gradeGroup: is.string, unit: is.string, quantityTotal: is.string, partialFulfilmentAllowed: is.bool, originMarketId: is.string, availableFrom: is.iso, availableTo: is.iso, expiresAt: is.iso, fulfilment: is.object, priceExpectation: is.object }, idem: true }, ({ p, user, body }) => created(p.createLot(user, body as never)));
route("GET", "/me/sell-lots", {}, ({ p, user }) => ({ items: [...p.lots.values()].filter((l) => l.sellerId === user.userId) }));
route("GET", "/sell-lots/:id", {}, ({ p, user, params }) => p.getLotForOwner(user, params.id as string));
route("PATCH", "/sell-lots/:id", {}, ({ p, user, params, body, ifMatch }) => p.updateLot(user, params.id as string, body, ifMatch));
route("POST", "/sell-lots/:id/photos", {}, ({ p, user, params }) => p.addLotPhoto(user, params.id as string));
route("POST", "/sell-lots/:id/activate", { idem: true }, ({ p, user, params }) => p.activateLot(user, params.id as string));
route("POST", "/sell-lots/:id/withdraw", { idem: true }, ({ p, user, params }) => p.withdrawLot(user, params.id as string));
route("GET", "/sell-lots/:id/matches", {}, ({ p, user, params }) => ({ items: p.matchesForLot(user, params.id as string) }));

// ---- buy requirements ----
const reqShape: Shape = { productId: is.string, gradeGroup: is.string, unit: is.string, targetQuantity: is.string, destinationMarketId: is.string, maxRadiusKm: (v) => typeof v === "number" && v > 0, requiredFrom: is.iso, requiredBy: is.iso, expiresAt: is.iso };
route("POST", "/buy-requirements", { shape: reqShape, idem: true }, ({ p, user, body }) => created(p.createRequirement(user, body as never)));
route("POST", "/buy-requirements/recurring", { shape: { ...reqShape, cadence: is.oneOf("WEEKLY", "FORTNIGHTLY", "MONTHLY"), occurrences: is.int }, idem: true }, ({ p, user, body }) => created(p.createRecurringRequirement(user, body as never, body.cadence, body.occurrences)));
route("GET", "/me/buy-requirements", {}, ({ p, user }) => ({ items: [...p.requirements.values()].filter((r) => r.buyerId === user.userId) }));
route("GET", "/buy-requirements/:id/matches", {}, ({ p, user, params }) => ({ items: p.matchesForRequirement(user, params.id as string) }));
route("POST", "/buy-requirements/:id/close", {}, ({ p, user, params }) => p.closeRequirement(user, params.id as string));

// ---- offers & threads ----
route("POST", "/offers", { shape: { sellLotId: is.string, ...termsShape }, idem: true }, ({ p, user, body }) => created(p.createOffer(user, body as never)));
route("GET", "/offers", {}, ({ p, user }) => ({ items: p.listOffers(user) }));
route("POST", "/offers/:id/counter", { shape: termsShape, idem: true }, ({ p, user, params, body, ifMatch }) => created(p.counterOffer(user, params.id as string, body.terms, body.expiresAt, ifMatch)));
route("POST", "/offers/:id/accept", { idem: true }, ({ p, user, params, ifMatch }) => created(p.acceptOffer(user, params.id as string, ifMatch)));
route("POST", "/offers/:id/reject", {}, ({ p, user, params }) => p.rejectOffer(user, params.id as string));
route("POST", "/offers/:id/withdraw", {}, ({ p, user, params }) => p.withdrawOffer(user, params.id as string));
route("POST", "/threads/:id/contact-reveal", { idem: true }, ({ p, user, params }) => p.revealContact(user, params.id as string));
route("POST", "/users/:id/block", {}, ({ p, user, params }) => (p.blockUser(user, params.id as string), { ok: true }));
route("POST", "/users/:id/report", { shape: { reason: is.string } }, ({ p, user, params, body }) => created(p.reportUser(user, params.id as string, body.reason)));
route("GET", "/users/:id/reputation", { auth: false }, ({ p, params }) => p.publicReputation(params.id as string));

// ---- deals & disputes ----
route("GET", "/deals", {}, ({ p, user }) => ({ items: p.listDeals(user) }));
route("GET", "/deals/:id", {}, ({ p, user, session, params }) => p.getDeal2(user, params.id as string, { session }));
route("POST", "/deals/:id/amendments", { shape: { terms: is.object }, idem: true }, ({ p, user, params, body }) => p.proposeAmendment(user, params.id as string, body.terms));
route("POST", "/deals/:id/amendments/respond", { shape: { accept: is.bool } }, ({ p, user, params, body }) => p.respondAmendment(user, params.id as string, body.accept));
route("POST", "/deals/:id/pickup", { idem: true }, ({ p, user, params }) => p.confirmPickup(user, params.id as string));
route("POST", "/deals/:id/delivery", { idem: true }, ({ p, user, params, body }) => p.confirmDelivery(user, params.id as string, body.actualQuantity));
route("POST", "/deals/:id/accept", { idem: true }, ({ p, user, params }) => p.acceptDelivery(user, params.id as string));
route("POST", "/deals/:id/payment", { shape: { method: is.string }, idem: true }, ({ p, user, params, body }) => p.confirmPayment(user, params.id as string, body.method));
route("POST", "/deals/:id/complete", { idem: true }, ({ p, user, params }) => p.completeDeal(user, params.id as string));
route("POST", "/deals/:id/cancel", { shape: { reason: is.string }, idem: true }, ({ p, user, params, body }) => p.cancelDeal(user, params.id as string, body.reason));
route("POST", "/deals/:id/evidence", { shape: { kind: is.string, note: is.string } }, ({ p, user, params, body }) => created(p.addDealEvidence(user, params.id as string, body.kind, body.note)));
route("GET", "/deals/:id/evidence", {}, ({ p, user, session, params }) => ({ items: p.dealEvidence(user, session, params.id as string) }));
route("POST", "/deals/:id/disputes", { shape: { reason: is.string }, idem: true }, ({ p, user, params, body }) => created(p.openDispute(user, params.id as string, body as never)));
route("GET", "/disputes/:id", {}, ({ p, user, params }) => p.getDispute(user, params.id as string));
route("POST", "/disputes/:id/response", { shape: { text: is.string } }, ({ p, user, params, body }) => p.respondDispute(user, params.id as string, body.text, body.evidenceIds ?? []));

// ---- operations (separate capabilities + step-up enforced in platform.require) ----
route("GET", "/ops/queues", {}, ({ p, user, session, query }) => ({ items: p.listQueue(user, session, (query.get("queue") ?? undefined) as never) }));
route("GET", "/ops/source-health", {}, ({ p, user, session }) => ({ items: p.listSourceHealth(user, session) }));
route("GET", "/ops/audit", {}, ({ p, user, session }) => ({ items: p.readAudit(user, session) }));
route("POST", "/ops/observations/:id/review", { shape: { decision: is.oneOf("APPROVE", "REJECT"), reason: is.string } }, ({ p, user, session, params, body }) => p.reviewObservation(user, session, params.id as string, body.decision, body.reason));
route("POST", "/ops/mapping/:id/resolve", { shape: { mapping: is.object, reason: is.string } }, ({ p, user, session, params, body }) => p.resolveMapping(user, session, params.id as string, body.mapping, body.reason));
route("POST", "/ops/prices/refresh", {}, ({ p, user, session }) => (p.require(user, session, "ops.price_review"), { changed: p.refreshAggregates() }));
route("POST", "/ops/claims/:id/decision", { shape: { decision: is.string, reasonCode: is.string } }, ({ p, user, session, params, body }) => p.decideClaim(user, session, params.id as string, body.decision, body.reasonCode, body.expiresAt));
route("POST", "/ops/listings/:id/review", { shape: { decision: is.oneOf("APPROVE", "SUSPEND", "RETURN"), reason: is.string } }, ({ p, user, session, params, body }) => p.reviewListing(user, session, params.id as string, body.decision, body.reason));
route("POST", "/ops/listings/:id/photo-exception", { shape: { reason: is.string } }, ({ p, user, session, params, body }) => p.grantPhotoException(user, session, params.id as string, body.reason));
route("GET", "/ops/requirements/:id/matches", {}, ({ p, user, session, params }) => ({ items: p.operatorMatches(user, session, params.id as string) }));
route("POST", "/ops/disputes/:id/resolve", { shape: { outcome: is.string, reason: is.string } }, ({ p, user, session, params, body }) => p.resolveDispute(user, session, params.id as string, body.outcome, body.reason));
route("POST", "/ops/users/:id/suspend", { shape: { reason: is.string } }, ({ p, user, session, params, body }) => (p.suspendUser(user, session, params.id as string, body.reason), { ok: true }));

// ---- server --------------------------------------------------------------
export interface ServerOptions { platform: Platform; logger?: Logger; metrics?: Metrics; maxBodyBytes?: number; requestsPerMinute?: number }

export function createApp(opts: ServerOptions): Server {
  const { platform: p } = opts;
  const log = opts.logger ?? createLogger(() => {});
  const metrics = opts.metrics ?? new Metrics();
  const buckets = new Map<string, { n: number; reset: number }>();
  const limit = opts.requestsPerMinute ?? 300;
  const maxBody = opts.maxBodyBytes ?? 256 * 1024;

  const send = (res: ServerResponse, status: number, body: unknown, cid: string, extra: Record<string, string> = {}) => {
    const data = JSON.stringify(body);
    res.writeHead(status, { "content-type": status >= 400 ? "application/problem+json" : "application/json", "x-correlation-id": cid, "x-content-type-options": "nosniff", "cache-control": status === 200 && extra["x-public"] ? "public, max-age=60" : "no-store", ...extra });
    res.end(data);
  };

  const readBody = (req: IncomingMessage) => new Promise<unknown>((resolve, reject) => {
    const chunks: Buffer[] = []; let size = 0;
    req.on("data", (c: Buffer) => { size += c.length; if (size > maxBody) { reject(new DomainError("PAYLOAD_TOO_LARGE", 413, "Payload too large")); req.destroy(); } else chunks.push(c); });
    req.on("end", () => { if (!chunks.length) return resolve({}); try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); } catch { reject(new DomainError("MALFORMED_JSON", 400, "Malformed JSON")); } });
    req.on("error", reject);
  });

  return createServer(async (req, res) => {
    const cid = (req.headers["x-correlation-id"] as string | undefined)?.slice(0, 64) || newCorrelationId();
    p.correlationId = cid;
    const url = new URL(req.url ?? "/", "http://x");
    const locale = parseLocale(req.headers["accept-language"] as string | undefined, url.searchParams.get("lang"));
    const fail = (status: number, code: string, title: string, detail: string, fieldErrors: FieldError[] = [], messageKey?: string) => {
      const pr = problem(status, code, title, detail, cid, fieldErrors, messageKey);
      send(res, status, { ...pr, message: t(locale, pr.messageKey) }, cid);
    };
    try {
      if (url.pathname === "/healthz") return send(res, 200, { status: "ok" }, cid);
      if (url.pathname === "/readyz") return send(res, 200, { status: "ready", metrics: metrics.snapshot() }, cid);
      const ip = req.socket.remoteAddress ?? "?";
      const now = p.now().getTime();
      const b = buckets.get(ip);
      if (!b || b.reset < now) buckets.set(ip, { n: 1, reset: now + 60_000 });
      else if (++b.n > limit) { res.setHeader("retry-after", "30"); return fail(429, "RATE_LIMITED", "Too many requests", "Retry later", [], "error.rate_limited"); }

      const match = routes.find((r) => r.method === req.method && r.re.test(url.pathname));
      if (!match) return fail(404, "NOT_FOUND", "Not found", "No such endpoint", [], "error.not_found");
      const m = match.re.exec(url.pathname) as RegExpExecArray;
      const params = Object.fromEntries(match.keys.map((k, i) => [k, decodeURIComponent(m[i + 1] as string)]));
      const raw = req.method === "GET" ? {} : await readBody(req);
      if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return fail(400, "MALFORMED_JSON", "Malformed request", "Body must be a JSON object");
      const body = raw as Record<string, any>;
      if (match.shape) {
        const errs = check(body, match.shape);
        if (errs.length) return fail(422, "VALIDATION_FAILED", "Validation failed", "Some fields are invalid", errs, "error.validation_failed");
      }
      let user: User | undefined, session: Session | undefined;
      if (match.auth) {
        const auth = req.headers.authorization;
        ({ user, session } = p.authenticate(auth?.startsWith("Bearer ") ? auth.slice(7) : undefined));
      }
      const ifMatchHeader = req.headers["if-match"];
      const ctx = { p, body, params, query: url.searchParams, user: user as User, session: session as Session, locale, idemKey: req.headers["idempotency-key"] as string | undefined, ifMatch: ifMatchHeader ? Number(String(ifMatchHeader).replace(/"/g, "")) : undefined } satisfies Ctx;
      const run = () => match.h(ctx);
      const out = match.idem ? p.idempotent(user?.userId ?? ip, `${req.method} ${url.pathname}`, ctx.idemKey, body, run) : run();
      metrics.inc(`http.${req.method}.ok`);
      if (out && typeof out === "object" && "status" in out && "body" in out) return send(res, (out as { status: number }).status, (out as { body: unknown }).body, cid);
      return send(res, 200, out, cid, !match.auth ? { "x-public": "1" } : {});
    } catch (e) {
      if (e instanceof DomainError) {
        metrics.inc(`http.error.${e.code}`);
        if (e.status === 429) res.setHeader("retry-after", "60");
        return fail(e.status, e.code, e.message, e.message, [], e.messageKey);
      }
      log.error("unhandled", { cid, err: e instanceof Error ? e.name : "unknown" }); // no stack/SQL to clients
      metrics.inc("http.error.internal");
      return fail(503, "UNAVAILABLE", "Temporarily unavailable", "Try again later");
    }
  });
}
