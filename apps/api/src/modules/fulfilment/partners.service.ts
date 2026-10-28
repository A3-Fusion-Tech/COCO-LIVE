import { conflict, forbidden, invalid, notFound, type Deal } from "@livecoco/domain";
import { C } from "../../core/collections.ts";
import { uid } from "../../core/ids.ts";
import { orNotFound, type Scope } from "../../core/scope.ts";
import type { AuditLog, WorkQueue } from "../../core/audit.ts";
import type { Notifier } from "../../core/notifier.ts";
import type { IdentityService } from "../identity/identity.service.ts";
import type { DealsService } from "../deals/deals.service.ts";
import type { LotsService } from "../marketplace/lots.service.ts";
import type { Inspection, InspectionResult, Partner, TransportQuote, TransportRequest, TransportStatus } from "./fulfilment.types.ts";

const hours = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 3_600_000;
const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100) / 100 : null);

/** Inspection and logistics partners: onboarding, inspections on agreed deals, transport quotes, bookings and tracking. */
export class PartnersService {
  private readonly identity: IdentityService;
  private readonly deals: DealsService;
  private readonly lots: LotsService;
  private readonly audit: AuditLog;
  private readonly queue: WorkQueue;
  private readonly notifier: Notifier;

  constructor(identity: IdentityService, deals: DealsService, lots: LotsService, audit: AuditLog, queue: WorkQueue, notifier: Notifier) {
    this.identity = identity;
    this.deals = deals;
    this.lots = lots;
    this.audit = audit;
    this.queue = queue;
    this.notifier = notifier;
  }

  // ---- partners ------------------------------------------------------------------------------
  async apply(s: Scope, organizationId: string, serviceMarketIds: string[]): Promise<Partner> {
    const org = await this.identity.requireOrg(s, organizationId);
    if (!org.members.some((m) => m.userId === s.user.userId && m.role === "OWNER")) throw forbidden();
    const kind = org.kind === "INSPECTION_PARTNER" ? "INSPECTION" : org.kind === "LOGISTICS_PARTNER" ? "LOGISTICS" : undefined;
    if (!kind) throw invalid("NOT_A_PARTNER_ORG", "Organization kind must be INSPECTION_PARTNER or LOGISTICS_PARTNER");
    if (await s.tx.has(C.partners, organizationId)) throw conflict("PARTNER_EXISTS", "Already applied");
    const partner: Partner = { partnerId: organizationId, organizationId, kind, serviceMarketIds, status: "PENDING", decidedBy: undefined, reason: undefined, createdAt: s.iso() };
    s.tx.put(C.partners, organizationId, partner);
    this.queue.enqueue(s, { queue: "VERIFICATION", subject: organizationId, summary: `${kind} partner application`, reasons: ["PARTNER_APPLICATION"], priority: 2, requiredCapability: "ops.verification" });
    return partner;
  }

  async decide(s: Scope, partnerId: string, decision: "APPROVED" | "REJECTED" | "SUSPENDED", reason: string): Promise<Partner> {
    this.identity.require(s, "ops.verification");
    if (!reason) throw invalid("REASON_REQUIRED", "A reason is required");
    const pt = orNotFound(await s.tx.get<Partner>(C.partners, partnerId), "Partner");
    await this.queue.close(s, partnerId);
    this.audit.record(s, s.user.userId, "PARTNER_DECIDED", partnerId, reason, { decision });
    return s.tx.put(C.partners, partnerId, { ...pt, status: decision, decidedBy: s.user.userId, reason });
  }

  /** The approved partner of this kind the actor belongs to. */
  private async partnerFor(s: Scope, kind: Partner["kind"]): Promise<Partner> {
    for (const p of await s.tx.find<Partner>(C.partners, { kind, status: "APPROVED" })) if (await this.identity.isMember(s, p.organizationId, s.user.userId)) return p;
    throw forbidden(`Approved ${kind.toLowerCase()} partner membership required`);
  }
  private async memberOf(s: Scope, organizationId: string | undefined) { return !!organizationId && this.identity.isMember(s, organizationId, s.user.userId); }

  async list(s: Scope, kind?: string, marketId?: string) {
    const out = [];
    for (const x of await s.tx.find<Partner>(C.partners, { status: "APPROVED", ...(kind ? { kind } : {}) })) {
      if (marketId && !x.serviceMarketIds.includes(marketId)) continue;
      out.push({ partnerId: x.partnerId, kind: x.kind, name: (await this.identity.org(s, x.organizationId))?.name, serviceMarketIds: x.serviceMarketIds });
    }
    return out;
  }

  async mine(s: Scope) {
    const out: Partner[] = [];
    for (const id of s.user.organizationIds) { const p = await s.tx.get<Partner>(C.partners, id); if (p && (await this.memberOf(s, id))) out.push(p); }
    return out;
  }

  /** Measurable service levels; visible to the partner's members and verification operators. */
  async sla(s: Scope, partnerId: string) {
    if (!(await this.memberOf(s, partnerId)) && !s.user.capabilities.includes("ops.verification")) throw notFound();
    const rows = await s.tx.find<Inspection>(C.inspections, { partnerId });
    const accepted = rows.filter((x) => x.acceptedAt);
    const done = rows.filter((x) => x.completedAt);
    const quotes = await s.tx.find<TransportQuote>(C.transportQuotes, { partnerId });
    const reqs = await s.tx.find<TransportRequest>(C.transportRequests, { partnerId });
    const delivered = reqs.filter((r) => r.deliveredAt);
    const quoteHours: number[] = [];
    for (const q of quotes) quoteHours.push(hours((await s.tx.get<TransportRequest>(C.transportRequests, q.requestId))?.openedAt ?? q.respondedAt, q.respondedAt));
    return {
      partnerId,
      inspections: {
        total: rows.length, avgHoursToAccept: avg(accepted.map((x) => hours(x.requestedAt, x.acceptedAt as string))), avgHoursToComplete: avg(done.map((x) => hours(x.requestedAt, x.completedAt as string))),
        onTimeRatePercent: done.length ? Math.round((done.filter((x) => Date.parse(x.completedAt as string) <= Date.parse(x.scheduledAt) + 6 * 3_600_000).length / done.length) * 100) : null,
      },
      transport: {
        quotesSubmitted: quotes.length, avgHoursToQuote: avg(quoteHours), booked: reqs.length, delivered: delivered.length,
        onTimeRatePercent: delivered.length ? Math.round((delivered.filter((r) => Date.parse(r.deliveredAt as string) <= Date.parse(r.windowTo)).length / delivered.length) * 100) : null,
      },
    };
  }

  // ---- inspections ---------------------------------------------------------------------------
  private async inspection(s: Scope, id: string) { return orNotFound(await s.tx.get<Inspection>(C.inspections, id), "Inspection"); }
  private saveInspection(s: Scope, i: Inspection) { return s.tx.put(C.inspections, i.inspectionId, i); }

  async requestInspection(s: Scope, dealId: string, input: { partnerId: string; scheduledAt: string; location: string }): Promise<Inspection> {
    const d = await this.deals.asParty(s, dealId);
    if (d.status !== "AGREED") throw conflict("INSPECTION_NOT_ALLOWED", `Inspection can only be requested for an agreed deal (deal is ${d.status})`);
    const pt = await s.tx.get<Partner>(C.partners, input.partnerId);
    if (!pt || pt.kind !== "INSPECTION" || pt.status !== "APPROVED") throw invalid("PARTNER_UNAVAILABLE", "Unknown or unapproved inspection partner");
    if (Date.parse(input.scheduledAt) <= s.ms()) throw invalid("SCHEDULE_IN_PAST", "Schedule a future time");
    const i: Inspection = { inspectionId: uid("insp"), dealId, requestedBy: s.user.userId, partnerId: pt.partnerId, status: "REQUESTED", scheduledAt: input.scheduledAt, location: input.location, requestedAt: s.iso(), acceptedAt: undefined, completedAt: undefined, result: undefined, decision: undefined, version: 1 };
    this.saveInspection(s, i);
    this.deals.move(s, d, "INSPECTION_PENDING", "INSPECTION_REQUESTED", s.user.userId, { inspectionId: i.inspectionId });
    return i;
  }

  async dealInspections(s: Scope, dealId: string) {
    await this.deals.asParty(s, dealId);
    return s.tx.find<Inspection>(C.inspections, { dealId });
  }

  async myInspections(s: Scope) {
    const out: Inspection[] = [];
    for (const id of s.user.organizationIds) if (await this.memberOf(s, id)) out.push(...(await s.tx.find<Inspection>(C.inspections, { partnerId: id })));
    return out;
  }

  async acceptInspection(s: Scope, inspectionId: string): Promise<Inspection> {
    const i = await this.inspection(s, inspectionId);
    if ((await this.partnerFor(s, "INSPECTION")).partnerId !== i.partnerId) throw notFound("Inspection");
    if (i.status !== "REQUESTED") throw conflict("INVALID_TRANSITION", `Inspection is ${i.status}`);
    return this.saveInspection(s, { ...i, status: "SCHEDULED", acceptedAt: s.iso(), version: i.version + 1 });
  }

  async submitResult(s: Scope, inspectionId: string, result: InspectionResult): Promise<Inspection> {
    const i = await this.inspection(s, inspectionId);
    if ((await this.partnerFor(s, "INSPECTION")).partnerId !== i.partnerId) throw notFound("Inspection");
    if (i.status !== "SCHEDULED") throw conflict("INVALID_TRANSITION", `Inspection is ${i.status}`);
    if (!["PASS", "FAIL", "CONDITIONAL"].includes(result.outcome)) throw invalid("INVALID_OUTCOME", "Outcome must be PASS, FAIL or CONDITIONAL");
    for (const v of Object.values(result.measurements)) if (!Number.isFinite(v)) throw invalid("INVALID_MEASUREMENT", "Measurements must be numbers");
    Object.assign(i, { result, status: "COMPLETED", completedAt: s.iso(), version: i.version + 1 });
    this.saveInspection(s, i);
    const d = await this.deals.get(s, i.dealId);
    this.identity.addEvidence(s, { ownerId: s.user.userId, dealId: i.dealId, kind: "INSPECTION_RESULT", visibleTo: [d.sellerId, d.buyerId, s.user.userId], note: JSON.stringify(result), sensitive: false });
    this.deals.event(s, d, "INSPECTION_COMPLETED", s.user.userId, { inspectionId, outcome: result.outcome });
    if (result.outcome === "PASS") await this.finishInspection(s, i, d, true);
    return i;
  }

  /** On FAIL/CONDITIONAL the buyer decides whether to proceed; PASS proceeds automatically. */
  async decideInspection(s: Scope, inspectionId: string, accept: boolean): Promise<Inspection> {
    const i = await this.inspection(s, inspectionId);
    const d = await this.deals.asParty(s, i.dealId);
    if (i.status !== "COMPLETED") throw conflict("INVALID_TRANSITION", `Inspection is ${i.status}`);
    if (s.user.userId !== d.buyerId) throw forbidden("The buyer decides after an inspection");
    await this.finishInspection(s, i, d, accept);
    return i;
  }

  private async finishInspection(s: Scope, i: Inspection, d: Deal, accept: boolean) {
    Object.assign(i, { decision: { by: s.user.userId, accept, at: s.iso() }, status: "DECIDED", version: i.version + 1 });
    this.saveInspection(s, i);
    this.deals.move(s, d, accept ? "AGREED" : "CANCELLED", accept ? "INSPECTION_ACCEPTED" : "INSPECTION_REJECTED", s.user.userId, { inspectionId: i.inspectionId });
    if (!accept) await this.deals.releaseReservation(s, d);
  }

  // ---- logistics -----------------------------------------------------------------------------
  private async transport(s: Scope, id: string) { return orNotFound(await s.tx.get<TransportRequest>(C.transportRequests, id), "Transport request"); }
  private saveTransport(s: Scope, r: TransportRequest) { return s.tx.put(C.transportRequests, r.requestId, r); }

  async requestTransport(s: Scope, dealId: string, input: { destinationMarketId: string; weightKg: number; windowFrom: string; windowTo: string }): Promise<TransportRequest> {
    const d = await this.deals.asParty(s, dealId);
    if (["COMPLETED", "CANCELLED", "DISPUTED"].includes(d.status)) throw conflict("DEAL_CLOSED", `Deal is ${d.status}`);
    if (!(input.weightKg > 0)) throw invalid("WEIGHT_INVALID", "Weight must be positive");
    const lot = await this.lots.get(s, d.sellLotId);
    const r: TransportRequest = {
      requestId: uid("trq"), dealId, requestedBy: s.user.userId, pickupMarketId: lot.originMarketId, destinationMarketId: input.destinationMarketId, weightKg: input.weightKg,
      windowFrom: input.windowFrom, windowTo: input.windowTo, status: "OPEN", bookedQuoteId: undefined, partnerId: undefined, vehicle: undefined,
      statusLog: [{ status: "OPEN", at: s.iso(), note: "" }], openedAt: s.iso(), deliveredAt: undefined,
    };
    return this.saveTransport(s, r);
  }

  /** Open requests in the logistics partner's service area (no deal or party details). */
  async openRequests(s: Scope) {
    const pt = await this.partnerFor(s, "LOGISTICS");
    return (await s.tx.find<TransportRequest>(C.transportRequests, { status: "OPEN" }))
      .filter((r) => pt.serviceMarketIds.includes(r.pickupMarketId))
      .map((r) => ({ requestId: r.requestId, pickupMarketId: r.pickupMarketId, destinationMarketId: r.destinationMarketId, weightKg: r.weightKg, windowFrom: r.windowFrom, windowTo: r.windowTo }));
  }

  async myJobs(s: Scope) {
    const out: TransportRequest[] = [];
    for (const id of s.user.organizationIds) if (await this.memberOf(s, id)) out.push(...(await s.tx.find<TransportRequest>(C.transportRequests, { partnerId: id })));
    return out;
  }

  async submitQuote(s: Scope, requestId: string, input: { pricePaise: number; vehicleType: string; etaFrom: string; etaTo: string; validUntil: string; referralFeeBps?: number }): Promise<TransportQuote> {
    const pt = await this.partnerFor(s, "LOGISTICS");
    const r = await this.transport(s, requestId);
    if (r.status !== "OPEN") throw conflict("REQUEST_CLOSED", `Request is ${r.status}`);
    if (!pt.serviceMarketIds.includes(r.pickupMarketId)) throw forbidden("Outside the partner's service area");
    if (!Number.isSafeInteger(input.pricePaise) || input.pricePaise <= 0) throw invalid("INVALID_PRICE", "Price must be positive integer paise");
    if (Date.parse(input.validUntil) <= s.ms()) throw invalid("QUOTE_EXPIRED", "validUntil is in the past");
    if ((await s.tx.find<TransportQuote>(C.transportQuotes, { requestId, partnerId: pt.partnerId, status: "OFFERED" })).length) throw conflict("QUOTE_EXISTS", "Withdraw or wait for the existing quote");
    const q: TransportQuote = { quoteId: uid("tq"), requestId, partnerId: pt.partnerId, pricePaise: input.pricePaise, vehicleType: input.vehicleType, etaFrom: input.etaFrom, etaTo: input.etaTo, validUntil: input.validUntil, status: "OFFERED", respondedAt: s.iso(), referralFeeBps: Math.min(Math.max(input.referralFeeBps ?? 0, 0), 2000) };
    s.tx.put(C.transportQuotes, q.quoteId, q);
    const d = await this.deals.get(s, r.dealId);
    for (const party of [d.sellerId, d.buyerId]) await this.notifier.notify(s, party, "SMS", "transport.quote", { requestId, quoteId: q.quoteId }, `tq:${q.quoteId}`);
    return q;
  }

  async listQuotes(s: Scope, requestId: string) {
    const r = await this.transport(s, requestId);
    await this.deals.asParty(s, r.dealId);
    return (await s.tx.find<TransportQuote>(C.transportQuotes, { requestId }))
      .map((q) => ({ ...q, status: q.status === "OFFERED" && Date.parse(q.validUntil) <= s.ms() ? ("EXPIRED" as const) : q.status }))
      .sort((a, b) => a.pricePaise - b.pricePaise || a.quoteId.localeCompare(b.quoteId));
  }

  async book(s: Scope, quoteId: string, vehicle: { registration: string; driverPhone: string }): Promise<TransportRequest> {
    const q = orNotFound(await s.tx.get<TransportQuote>(C.transportQuotes, quoteId), "Quote");
    const r = await this.transport(s, q.requestId);
    const d = await this.deals.asParty(s, r.dealId);
    if (r.status !== "OPEN") throw conflict("REQUEST_CLOSED", `Request is ${r.status}`);
    if (q.status !== "OFFERED" || Date.parse(q.validUntil) <= s.ms()) throw conflict("QUOTE_EXPIRED", "The quote is no longer valid");
    for (const o of await s.tx.find<TransportQuote>(C.transportQuotes, { requestId: r.requestId, status: "OFFERED" })) if (o.quoteId !== quoteId) s.tx.put(C.transportQuotes, o.quoteId, { ...o, status: "REJECTED" });
    s.tx.put(C.transportQuotes, quoteId, { ...q, status: "ACCEPTED" });
    Object.assign(r, { status: "BOOKED", bookedQuoteId: quoteId, partnerId: q.partnerId, vehicle });
    r.statusLog.push({ status: "BOOKED", at: s.iso(), note: "" });
    this.saveTransport(s, r);
    this.deals.event(s, d, "TRANSPORT_BOOKED", s.user.userId, { requestId: r.requestId, partnerId: q.partnerId, pricePaise: q.pricePaise });
    return r;
  }

  /** Vehicle and driver details are visible only to the deal parties and the booked partner. */
  async getTransport(s: Scope, requestId: string) {
    const r = await this.transport(s, requestId);
    const d = await this.deals.find(s, r.dealId);
    const party = !!d && (d.sellerId === s.user.userId || d.buyerId === s.user.userId);
    if (!party && !(await this.memberOf(s, r.partnerId))) throw notFound("Transport request");
    return r.status === "OPEN" || r.status === "CANCELLED" ? { ...r, vehicle: undefined } : r;
  }

  async updateTransport(s: Scope, requestId: string, status: "PICKED_UP" | "IN_TRANSIT" | "DELIVERED", note = ""): Promise<TransportRequest> {
    const pt = await this.partnerFor(s, "LOGISTICS");
    const r = await this.transport(s, requestId);
    if (r.partnerId !== pt.partnerId) throw notFound("Transport request");
    const order: TransportStatus[] = ["BOOKED", "PICKED_UP", "IN_TRANSIT", "DELIVERED"];
    if (order.indexOf(status) !== order.indexOf(r.status) + 1) throw conflict("INVALID_TRANSITION", `Transport cannot move ${r.status} → ${status}`);
    r.status = status;
    r.statusLog.push({ status, at: s.iso(), note });
    if (status === "DELIVERED") r.deliveredAt = s.iso();
    this.saveTransport(s, r);
    this.deals.event(s, await this.deals.get(s, r.dealId), "TRANSPORT_STATUS", s.user.userId, { requestId, status });
    return r;
  }
}
