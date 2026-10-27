import { createHmac, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DomainError, conflict, forbidden, invalid, notFound, addQuantity, compareQuantity, currentCard, estimateTotalPaise, toMilli, fromMilli, type Deal, type SellLot, type Unit } from "@livecoco/domain";
import type { TrackedMap } from "@livecoco/database";
import { uid } from "./ids.ts";
import type { Platform, Session, User } from "./platform.ts";

// ---- types --------------------------------------------------------------------------------
export interface Partner { partnerId: string; organizationId: string; kind: "INSPECTION" | "LOGISTICS"; serviceMarketIds: string[]; status: "PENDING" | "APPROVED" | "SUSPENDED" | "REJECTED"; decidedBy: string | undefined; reason: string | undefined; createdAt: string }

export type InspectionStatus = "REQUESTED" | "SCHEDULED" | "COMPLETED" | "DECIDED" | "CANCELLED";
export interface Inspection {
  inspectionId: string; dealId: string; requestedBy: string; partnerId: string; status: InspectionStatus; scheduledAt: string; location: string;
  requestedAt: string; acceptedAt: string | undefined; completedAt: string | undefined;
  result: { outcome: "PASS" | "FAIL" | "CONDITIONAL"; measurements: Record<string, number>; note: string } | undefined;
  decision: { by: string; accept: boolean; at: string } | undefined; version: number;
}

export type TransportStatus = "OPEN" | "BOOKED" | "PICKED_UP" | "IN_TRANSIT" | "DELIVERED" | "CANCELLED";
export interface TransportRequest {
  requestId: string; dealId: string; requestedBy: string; pickupMarketId: string; destinationMarketId: string; weightKg: number; windowFrom: string; windowTo: string;
  status: TransportStatus; bookedQuoteId: string | undefined; partnerId: string | undefined; vehicle: { registration: string; driverPhone: string } | undefined;
  statusLog: { status: TransportStatus; at: string; note: string }[]; openedAt: string; deliveredAt: string | undefined;
}
export interface TransportQuote { quoteId: string; requestId: string; partnerId: string; pricePaise: number; vehicleType: string; etaFrom: string; etaTo: string; validUntil: string; status: "OFFERED" | "ACCEPTED" | "REJECTED" | "EXPIRED"; respondedAt: string; referralFeeBps: number }

export interface MemberLot {
  memberLotId: string; organizationId: string; memberName: string; memberUserId: string | undefined; productId: string; gradeGroup: string; unit: Unit; quantity: string;
  originMarketId: string; quality: Record<string, string>; status: "PENDING_REVIEW" | "APPROVED" | "REJECTED" | "AGGREGATED" | "RELEASED"; createdBy: string; reviewedBy: string | undefined; aggregateLotId: string | undefined; version: number;
}
export interface AggregateLot { aggregateLotId: string; organizationId: string; sellLotId: string; tolerancePercent: number; contributions: { memberLotId: string; memberName: string; quantity: string }[]; totalQuantity: string; createdBy: string; createdAt: string }

export interface SettlementLine { memberLotId: string; memberName: string; quantity: string; grossPaise: number; deductionPaise: number; netPaise: number }
export interface Settlement {
  settlementId: string; dealId: string; aggregateLotId: string; organizationId: string; status: "DRAFT" | "APPROVED"; acceptedQuantity: string; unitPricePaise: number;
  grossPaise: number; deductions: { type: string; amountPaise: number }[]; deductionTotalPaise: number; netPaise: number; lines: SettlementLine[]; createdBy: string; approvedBy: string | undefined; approvedAt: string | undefined; createdAt: string; version: number;
}

export type MediaStatus = "PENDING_UPLOAD" | "UPLOADED" | "APPROVED" | "REJECTED";
export interface Media { mediaId: string; ownerId: string; purpose: "LOT_PHOTO" | "DEAL_EVIDENCE" | "VERIFICATION_DOCUMENT"; refId: string | undefined; contentType: string; declaredBytes: number; actualBytes: number | undefined; status: MediaStatus; rejectionReason: string | undefined; sha256: string | undefined; createdAt: string; expiresAt: string }

/** Object storage seam: local filesystem in development, S3-compatible in production. */
export interface BlobStore { put(key: string, bytes: Uint8Array): Promise<void>; get(key: string): Promise<Uint8Array | undefined>; delete(key: string): Promise<void> }
export class MemoryBlobStore implements BlobStore {
  private m = new Map<string, Uint8Array>();
  async put(k: string, b: Uint8Array) { this.m.set(k, b); }
  async get(k: string) { return this.m.get(k); }
  async delete(k: string) { this.m.delete(k); }
}

/** Local-disk object store for development/self-hosting; keys are validated so paths cannot escape the root. */
export class FsBlobStore implements BlobStore {
  private root: string;
  constructor(root: string) { this.root = root; }
  private path(key: string) {
    if (!/^private\/media_[0-9a-f]{16}$/.test(key)) throw new Error("invalid blob key");
    return join(this.root, key.replace("/", "-"));
  }
  async put(key: string, b: Uint8Array) { await mkdir(this.root, { recursive: true, mode: 0o700 }); await writeFile(this.path(key), b, { mode: 0o600 }); }
  async get(key: string) { try { return new Uint8Array(await readFile(this.path(key))); } catch { return undefined; } }
  async delete(key: string) { await rm(this.path(key), { force: true }); }
}

export const MEDIA_LIMITS: Record<string, { maxBytes: number; magic: number[][] }> = {
  "image/jpeg": { maxBytes: 8_000_000, magic: [[0xff, 0xd8, 0xff]] },
  "image/png": { maxBytes: 8_000_000, magic: [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]] },
  "image/webp": { maxBytes: 8_000_000, magic: [[0x52, 0x49, 0x46, 0x46]] },
  "application/pdf": { maxBytes: 12_000_000, magic: [[0x25, 0x50, 0x44, 0x46]] },
};

const hours = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 3_600_000;

/** Largest-remainder apportionment: shares sum exactly to `total`, deterministic on ties. */
export function apportion(total: number, weights: { id: string; weight: bigint }[]): Map<string, number> {
  const sum = weights.reduce((a, w) => a + w.weight, 0n);
  if (sum <= 0n) throw invalid("NO_WEIGHT", "Nothing to apportion");
  const t = BigInt(total);
  const parts = weights.map((w) => ({ id: w.id, base: (t * w.weight) / sum, rem: (t * w.weight) % sum }));
  let left = Number(t - parts.reduce((a, x) => a + x.base, 0n));
  const order = [...parts].sort((a, b) => (a.rem === b.rem ? a.id.localeCompare(b.id) : a.rem > b.rem ? -1 : 1));
  const extra = new Set(order.slice(0, left).map((x) => x.id));
  left = 0;
  return new Map(parts.map((x) => [x.id, Number(x.base) + (extra.has(x.id) ? 1 : 0)]));
}

export class Fulfilment {
  private p: Platform;
  partners: TrackedMap<Partner>;
  inspections: TrackedMap<Inspection>;
  transportRequests: TrackedMap<TransportRequest>;
  transportQuotes: TrackedMap<TransportQuote>;
  memberLots: TrackedMap<MemberLot>;
  aggregateLots: TrackedMap<AggregateLot>;
  settlements: TrackedMap<Settlement>;
  media: TrackedMap<Media>;
  blobs: BlobStore;
  uploadSecret: string;
  baseUrl: string;

  constructor(p: Platform, blobs: BlobStore = new MemoryBlobStore(), uploadSecret = "dev-upload-secret-change-me") {
    this.p = p;
    this.partners = p.table<Partner>("partners");
    this.inspections = p.table<Inspection>("inspections");
    this.transportRequests = p.table<TransportRequest>("transportRequests");
    this.transportQuotes = p.table<TransportQuote>("transportQuotes");
    this.memberLots = p.table<MemberLot>("memberLots");
    this.aggregateLots = p.table<AggregateLot>("aggregateLots");
    this.settlements = p.table<Settlement>("settlements");
    this.media = p.table<Media>("media");
    this.blobs = blobs;
    this.uploadSecret = uploadSecret;
    this.baseUrl = "";
  }

  // ---- partners ---------------------------------------------------------
  applyPartner(user: User, organizationId: string, serviceMarketIds: string[]): Partner {
    const org = this.p.orgs.get(organizationId) ?? (() => { throw notFound("Organization"); })();
    if (!org.members.some((m) => m.userId === user.userId && m.role === "OWNER")) throw forbidden();
    const kind = org.kind === "INSPECTION_PARTNER" ? "INSPECTION" : org.kind === "LOGISTICS_PARTNER" ? "LOGISTICS" : undefined;
    if (!kind) throw invalid("NOT_A_PARTNER_ORG", "Organization kind must be INSPECTION_PARTNER or LOGISTICS_PARTNER");
    if (this.partners.has(organizationId)) throw conflict("PARTNER_EXISTS", "Already applied");
    const partner: Partner = { partnerId: organizationId, organizationId, kind, serviceMarketIds, status: "PENDING", decidedBy: undefined, reason: undefined, createdAt: this.p.iso() };
    this.partners.set(organizationId, partner);
    this.p.enqueue({ queue: "VERIFICATION", subject: organizationId, summary: `${kind} partner application`, reasons: ["PARTNER_APPLICATION"], priority: 2, requiredCapability: "ops.verification" });
    return partner;
  }
  decidePartner(op: User, session: Session, partnerId: string, decision: "APPROVED" | "REJECTED" | "SUSPENDED", reason: string): Partner {
    this.p.require(op, session, "ops.verification");
    if (!reason) throw invalid("REASON_REQUIRED", "A reason is required");
    const pt = this.partners.get(partnerId) ?? (() => { throw notFound("Partner"); })();
    pt.status = decision; pt.decidedBy = op.userId; pt.reason = reason;
    for (const q of this.p.queue.values()) if (q.subject === partnerId) q.status = "DONE";
    this.p.log(op.userId, "PARTNER_DECIDED", partnerId, reason, { decision });
    return pt;
  }
  private partnerFor(user: User, kind: Partner["kind"]): Partner {
    const pt = [...this.partners.values()].find((x) => x.kind === kind && x.status === "APPROVED" && this.p.orgs.get(x.organizationId)?.members.some((m) => m.userId === user.userId));
    if (!pt) throw forbidden(`Approved ${kind.toLowerCase()} partner membership required`);
    return pt;
  }
  listPartners(kind?: string, marketId?: string) {
    return [...this.partners.values()].filter((x) => x.status === "APPROVED" && (!kind || x.kind === kind) && (!marketId || x.serviceMarketIds.includes(marketId))).map((x) => ({ partnerId: x.partnerId, kind: x.kind, name: this.p.orgs.get(x.organizationId)?.name, serviceMarketIds: x.serviceMarketIds }));
  }

  // ---- inspections ------------------------------------------------------
  requestInspection(user: User, dealId: string, input: { partnerId: string; scheduledAt: string; location: string }): Inspection {
    const d = this.p.dealParty(user, dealId);
    if (d.status !== "AGREED") throw conflict("INSPECTION_NOT_ALLOWED", `Inspection can only be requested for an agreed deal (deal is ${d.status})`);
    const pt = this.partners.get(input.partnerId);
    if (!pt || pt.kind !== "INSPECTION" || pt.status !== "APPROVED") throw invalid("PARTNER_UNAVAILABLE", "Unknown or unapproved inspection partner");
    if (Date.parse(input.scheduledAt) <= this.p.now().getTime()) throw invalid("SCHEDULE_IN_PAST", "Schedule a future time");
    const i: Inspection = { inspectionId: uid("insp"), dealId, requestedBy: user.userId, partnerId: pt.partnerId, status: "REQUESTED", scheduledAt: input.scheduledAt, location: input.location, requestedAt: this.p.iso(), acceptedAt: undefined, completedAt: undefined, result: undefined, decision: undefined, version: 1 };
    this.inspections.set(i.inspectionId, i);
    this.p.moveDeal(d, "INSPECTION_PENDING", "INSPECTION_REQUESTED", user.userId, { inspectionId: i.inspectionId });
    return i;
  }
  private insp(id: string) { return this.inspections.get(id) ?? (() => { throw notFound("Inspection"); })(); }
  acceptInspection(partnerUser: User, inspectionId: string): Inspection {
    const i = this.insp(inspectionId);
    if (this.partnerFor(partnerUser, "INSPECTION").partnerId !== i.partnerId) throw notFound("Inspection");
    if (i.status !== "REQUESTED") throw conflict("INVALID_TRANSITION", `Inspection is ${i.status}`);
    i.status = "SCHEDULED"; i.acceptedAt = this.p.iso(); i.version++;
    return i;
  }
  submitInspectionResult(partnerUser: User, inspectionId: string, result: NonNullable<Inspection["result"]>): Inspection {
    const i = this.insp(inspectionId);
    if (this.partnerFor(partnerUser, "INSPECTION").partnerId !== i.partnerId) throw notFound("Inspection");
    if (i.status !== "SCHEDULED") throw conflict("INVALID_TRANSITION", `Inspection is ${i.status}`);
    if (!["PASS", "FAIL", "CONDITIONAL"].includes(result.outcome)) throw invalid("INVALID_OUTCOME", "Outcome must be PASS, FAIL or CONDITIONAL");
    for (const v of Object.values(result.measurements)) if (!Number.isFinite(v)) throw invalid("INVALID_MEASUREMENT", "Measurements must be numbers");
    i.result = result; i.status = "COMPLETED"; i.completedAt = this.p.iso(); i.version++;
    const d = this.p.getDeal(i.dealId);
    const ev = { evidenceId: uid("ev"), ownerId: partnerUser.userId, dealId: i.dealId, kind: "INSPECTION_RESULT", visibleTo: [d.sellerId, d.buyerId, partnerUser.userId], note: JSON.stringify(result), at: this.p.iso(), sensitive: false };
    this.p.evidence.set(ev.evidenceId, ev);
    this.p.event(d, "INSPECTION_COMPLETED", partnerUser.userId, { inspectionId, outcome: result.outcome });
    if (result.outcome === "PASS") this.finishInspection(i, d, partnerUser.userId, true);
    return i;
  }
  /** On FAIL/CONDITIONAL the buyer decides whether to proceed; PASS proceeds automatically. */
  decideInspection(user: User, inspectionId: string, accept: boolean): Inspection {
    const i = this.insp(inspectionId);
    const d = this.p.dealParty(user, i.dealId);
    if (i.status !== "COMPLETED") throw conflict("INVALID_TRANSITION", `Inspection is ${i.status}`);
    if (user.userId !== d.buyerId) throw forbidden("The buyer decides after an inspection");
    this.finishInspection(i, d, user.userId, accept);
    return i;
  }
  private finishInspection(i: Inspection, d: Deal, actor: string, accept: boolean) {
    i.decision = { by: actor, accept, at: this.p.iso() }; i.status = "DECIDED"; i.version++;
    this.p.moveDeal(d, accept ? "AGREED" : "CANCELLED", accept ? "INSPECTION_ACCEPTED" : "INSPECTION_REJECTED", actor, { inspectionId: i.inspectionId });
    if (!accept) this.p.releaseReservation(d);
  }
  /** Measurable service levels for a partner. */
  partnerSla(partnerId: string) {
    const rows = [...this.inspections.values()].filter((x) => x.partnerId === partnerId);
    const accepted = rows.filter((x) => x.acceptedAt);
    const done = rows.filter((x) => x.completedAt);
    const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100) / 100 : null);
    const quotes = [...this.transportQuotes.values()].filter((q) => q.partnerId === partnerId);
    const reqs = [...this.transportRequests.values()].filter((r) => r.partnerId === partnerId);
    const delivered = reqs.filter((r) => r.deliveredAt);
    return {
      partnerId,
      inspections: { total: rows.length, avgHoursToAccept: avg(accepted.map((x) => hours(x.requestedAt, x.acceptedAt as string))), avgHoursToComplete: avg(done.map((x) => hours(x.requestedAt, x.completedAt as string))), onTimeRatePercent: done.length ? Math.round((done.filter((x) => Date.parse(x.completedAt as string) <= Date.parse(x.scheduledAt) + 6 * 3_600_000).length / done.length) * 100) : null },
      transport: { quotesSubmitted: quotes.length, avgHoursToQuote: avg(quotes.map((q) => hours(this.transportRequests.get(q.requestId)?.openedAt ?? q.respondedAt, q.respondedAt))), booked: reqs.length, delivered: delivered.length, onTimeRatePercent: delivered.length ? Math.round((delivered.filter((r) => Date.parse(r.deliveredAt as string) <= Date.parse(r.windowTo)).length / delivered.length) * 100) : null },
    };
  }

  // ---- logistics --------------------------------------------------------
  requestTransport(user: User, dealId: string, input: { destinationMarketId: string; weightKg: number; windowFrom: string; windowTo: string }): TransportRequest {
    const d = this.p.dealParty(user, dealId);
    if (["COMPLETED", "CANCELLED", "DISPUTED"].includes(d.status)) throw conflict("DEAL_CLOSED", `Deal is ${d.status}`);
    if (!(input.weightKg > 0)) throw invalid("WEIGHT_INVALID", "Weight must be positive");
    const lot = this.p.getLot(d.sellLotId);
    const r: TransportRequest = { requestId: uid("trq"), dealId, requestedBy: user.userId, pickupMarketId: lot.originMarketId, destinationMarketId: input.destinationMarketId, weightKg: input.weightKg, windowFrom: input.windowFrom, windowTo: input.windowTo, status: "OPEN", bookedQuoteId: undefined, partnerId: undefined, vehicle: undefined, statusLog: [{ status: "OPEN", at: this.p.iso(), note: "" }], openedAt: this.p.iso(), deliveredAt: undefined };
    this.transportRequests.set(r.requestId, r);
    return r;
  }
  openTransportRequests(partnerUser: User) {
    const pt = this.partnerFor(partnerUser, "LOGISTICS");
    return [...this.transportRequests.values()].filter((r) => r.status === "OPEN" && pt.serviceMarketIds.includes(r.pickupMarketId)).map((r) => ({ requestId: r.requestId, pickupMarketId: r.pickupMarketId, destinationMarketId: r.destinationMarketId, weightKg: r.weightKg, windowFrom: r.windowFrom, windowTo: r.windowTo }));
  }
  submitTransportQuote(partnerUser: User, requestId: string, input: { pricePaise: number; vehicleType: string; etaFrom: string; etaTo: string; validUntil: string; referralFeeBps?: number }): TransportQuote {
    const pt = this.partnerFor(partnerUser, "LOGISTICS");
    const r = this.transportRequests.get(requestId) ?? (() => { throw notFound("Transport request"); })();
    if (r.status !== "OPEN") throw conflict("REQUEST_CLOSED", `Request is ${r.status}`);
    if (!pt.serviceMarketIds.includes(r.pickupMarketId)) throw forbidden("Outside the partner's service area");
    if (!Number.isSafeInteger(input.pricePaise) || input.pricePaise <= 0) throw invalid("INVALID_PRICE", "Price must be positive integer paise");
    if (Date.parse(input.validUntil) <= this.p.now().getTime()) throw invalid("QUOTE_EXPIRED", "validUntil is in the past");
    if ([...this.transportQuotes.values()].some((q) => q.requestId === requestId && q.partnerId === pt.partnerId && q.status === "OFFERED")) throw conflict("QUOTE_EXISTS", "Withdraw or wait for the existing quote");
    const q: TransportQuote = { quoteId: uid("tq"), requestId, partnerId: pt.partnerId, pricePaise: input.pricePaise, vehicleType: input.vehicleType, etaFrom: input.etaFrom, etaTo: input.etaTo, validUntil: input.validUntil, status: "OFFERED", respondedAt: this.p.iso(), referralFeeBps: Math.min(Math.max(input.referralFeeBps ?? 0, 0), 2000) };
    this.transportQuotes.set(q.quoteId, q);
    const d = this.p.getDeal(r.dealId);
    for (const party of [d.sellerId, d.buyerId]) this.p.notify(party, "SMS", "transport.quote", { requestId, quoteId: q.quoteId }, `tq:${q.quoteId}`);
    return q;
  }
  listTransportQuotes(user: User, requestId: string) {
    const r = this.transportRequests.get(requestId) ?? (() => { throw notFound("Transport request"); })();
    this.p.dealParty(user, r.dealId);
    const now = this.p.now().getTime();
    return [...this.transportQuotes.values()].filter((q) => q.requestId === requestId).map((q) => ({ ...q, status: q.status === "OFFERED" && Date.parse(q.validUntil) <= now ? ("EXPIRED" as const) : q.status })).sort((a, b) => a.pricePaise - b.pricePaise || a.quoteId.localeCompare(b.quoteId));
  }
  bookTransport(user: User, quoteId: string, vehicle: { registration: string; driverPhone: string }): TransportRequest {
    const q = this.transportQuotes.get(quoteId) ?? (() => { throw notFound("Quote"); })();
    const r = this.transportRequests.get(q.requestId) as TransportRequest;
    const d = this.p.dealParty(user, r.dealId);
    if (r.status !== "OPEN") throw conflict("REQUEST_CLOSED", `Request is ${r.status}`);
    if (q.status !== "OFFERED" || Date.parse(q.validUntil) <= this.p.now().getTime()) throw conflict("QUOTE_EXPIRED", "The quote is no longer valid");
    q.status = "ACCEPTED";
    for (const o of this.transportQuotes.values()) if (o.requestId === r.requestId && o.quoteId !== q.quoteId && o.status === "OFFERED") o.status = "REJECTED";
    r.status = "BOOKED"; r.bookedQuoteId = q.quoteId; r.partnerId = q.partnerId; r.vehicle = vehicle;
    r.statusLog.push({ status: "BOOKED", at: this.p.iso(), note: "" });
    this.p.event(d, "TRANSPORT_BOOKED", user.userId, { requestId: r.requestId, partnerId: q.partnerId, pricePaise: q.pricePaise });
    return r;
  }
  /** Vehicle and driver details are visible only to the deal parties and the booked partner. */
  getTransport(user: User, requestId: string) {
    const r = this.transportRequests.get(requestId) ?? (() => { throw notFound("Transport request"); })();
    const d = this.p.deals.get(r.dealId);
    const party = d && (d.sellerId === user.userId || d.buyerId === user.userId);
    const partner = r.partnerId && this.p.orgs.get(r.partnerId)?.members.some((m) => m.userId === user.userId);
    if (!party && !partner) throw notFound("Transport request");
    if (r.status === "OPEN" || r.status === "CANCELLED") return { ...r, vehicle: undefined };
    return r;
  }
  updateTransport(partnerUser: User, requestId: string, status: "PICKED_UP" | "IN_TRANSIT" | "DELIVERED", note = ""): TransportRequest {
    const pt = this.partnerFor(partnerUser, "LOGISTICS");
    const r = this.transportRequests.get(requestId) ?? (() => { throw notFound("Transport request"); })();
    if (r.partnerId !== pt.partnerId) throw notFound("Transport request");
    const order: TransportStatus[] = ["BOOKED", "PICKED_UP", "IN_TRANSIT", "DELIVERED"];
    if (order.indexOf(status) !== order.indexOf(r.status) + 1) throw conflict("INVALID_TRANSITION", `Transport cannot move ${r.status} → ${status}`);
    r.status = status; r.statusLog.push({ status, at: this.p.iso(), note });
    if (status === "DELIVERED") r.deliveredAt = this.p.iso();
    this.p.event(this.p.getDeal(r.dealId), "TRANSPORT_STATUS", partnerUser.userId, { requestId, status });
    return r;
  }

  // ---- FPO aggregation ---------------------------------------------------
  private fpoManager(user: User, organizationId: string, roles: string[] = ["OWNER", "MEMBER", "FINANCE", "VERIFIER"]) {
    const org = this.p.orgs.get(organizationId) ?? (() => { throw notFound("Organization"); })();
    const m = org.members.find((x) => x.userId === user.userId);
    if (!m || !roles.includes(m.role)) throw forbidden();
    if (org.kind !== "FPO" && org.kind !== "FARMER_GROUP") throw invalid("NOT_AN_FPO", "Only FPO / farmer-group organizations aggregate member lots");
    return org;
  }
  addMemberLot(user: User, organizationId: string, input: { memberName: string; memberUserId?: string; productId: string; gradeGroup: string; unit: Unit; quantity: string; originMarketId: string; quality?: Record<string, string> }): MemberLot {
    this.fpoManager(user, organizationId);
    if (!input.memberName.trim()) throw invalid("MEMBER_REQUIRED", "Member name is required");
    if (toMilli(input.quantity) <= 0n) throw invalid("QUANTITY_NOT_POSITIVE", "Quantity must be positive");
    const m: MemberLot = { memberLotId: uid("mlot"), organizationId, memberName: input.memberName.trim(), memberUserId: input.memberUserId, productId: input.productId, gradeGroup: input.gradeGroup, unit: input.unit, quantity: input.quantity, originMarketId: input.originMarketId, quality: input.quality ?? {}, status: "PENDING_REVIEW", createdBy: user.userId, reviewedBy: undefined, aggregateLotId: undefined, version: 1 };
    this.memberLots.set(m.memberLotId, m);
    return m;
  }
  reviewMemberLot(user: User, memberLotId: string, approve: boolean): MemberLot {
    const m = this.memberLots.get(memberLotId) ?? (() => { throw notFound("Member lot"); })();
    this.fpoManager(user, m.organizationId, ["OWNER", "VERIFIER"]);
    if (m.status !== "PENDING_REVIEW") throw conflict("INVALID_TRANSITION", `Member lot is ${m.status}`);
    if (m.createdBy === user.userId && this.p.orgs.get(m.organizationId)!.members.length > 1) throw forbidden("A different manager must review this member lot");
    m.status = approve ? "APPROVED" : "REJECTED"; m.reviewedBy = user.userId; m.version++;
    return m;
  }
  /** Compatible member lots become one marketable sell lot while keeping member ownership mapping. */
  buildAggregate(user: User, organizationId: string, input: { memberLotIds: string[]; tolerancePercent?: number; availableFrom: string; availableTo: string; expiresAt: string; fulfilment: SellLot["fulfilment"]; priceExpectation: SellLot["priceExpectation"]; partialFulfilmentAllowed?: boolean }) {
    this.fpoManager(user, organizationId, ["OWNER", "VERIFIER"]);
    if (!input.memberLotIds.length) throw invalid("NO_MEMBER_LOTS", "Select at least one member lot");
    const lots = input.memberLotIds.map((id) => this.memberLots.get(id) ?? (() => { throw notFound("Member lot"); })());
    if (new Set(input.memberLotIds).size !== lots.length) throw invalid("DUPLICATE_MEMBER_LOT", "A member lot appears twice");
    const errors: string[] = [];
    const first = lots[0] as MemberLot;
    for (const l of lots) {
      if (l.organizationId !== organizationId) errors.push(`${l.memberLotId}:OTHER_ORGANIZATION`);
      if (l.status !== "APPROVED") errors.push(`${l.memberLotId}:NOT_APPROVED(${l.status})`);
      if (l.productId !== first.productId) errors.push(`${l.memberLotId}:PRODUCT_MISMATCH`);
      if (l.gradeGroup !== first.gradeGroup) errors.push(`${l.memberLotId}:GRADE_MISMATCH`);
      if (l.unit !== first.unit) errors.push(`${l.memberLotId}:UNIT_MISMATCH`);
    }
    if (errors.length) throw invalid("INCOMPATIBLE_MEMBER_LOTS", errors.join(", "));
    const total = lots.reduce((a, l) => addQuantity(a, l.quantity), "0");
    const attrs: Record<string, string> = {};
    for (const l of lots) for (const [k, v] of Object.entries(l.quality)) attrs[k] = attrs[k] === undefined || attrs[k] === v ? v : "MIXED";
    const sell = this.p.createLot(user, { organizationId, productId: first.productId as never, gradeAttributes: attrs, gradeGroup: first.gradeGroup, unit: first.unit, quantityTotal: total, partialFulfilmentAllowed: input.partialFulfilmentAllowed ?? true, originMarketId: first.originMarketId, availableFrom: input.availableFrom, availableTo: input.availableTo, expiresAt: input.expiresAt, fulfilment: input.fulfilment, priceExpectation: input.priceExpectation });
    const agg: AggregateLot = { aggregateLotId: uid("agg"), organizationId, sellLotId: sell.sellLotId, tolerancePercent: input.tolerancePercent ?? 2, contributions: lots.map((l) => ({ memberLotId: l.memberLotId, memberName: l.memberName, quantity: l.quantity })), totalQuantity: total, createdBy: user.userId, createdAt: this.p.iso() };
    this.aggregateLots.set(agg.aggregateLotId, agg);
    for (const l of lots) { l.status = "AGGREGATED"; l.aggregateLotId = agg.aggregateLotId; l.version++; }
    this.p.log(user.userId, "AGGREGATE_BUILT", agg.aggregateLotId, undefined, { members: lots.length, total });
    return { aggregate: agg, sellLot: sell };
  }
  /** Deal outcome → per-member payables. Quantity and price come from the immutable Deal Card and delivery event. */
  draftSettlement(user: User, dealId: string, deductions: { type: string; amountPaise: number }[] = []): Settlement {
    const d = this.p.deals.get(dealId) ?? (() => { throw notFound("Deal"); })();
    const agg = [...this.aggregateLots.values()].find((a) => a.sellLotId === d.sellLotId);
    if (!agg) throw invalid("NOT_AN_AGGREGATE_DEAL", "This deal was not made from an aggregate lot");
    this.fpoManager(user, agg.organizationId, ["OWNER", "FINANCE"]);
    if (!["ACCEPTED", "PAYMENT_CONFIRMED", "COMPLETED"].includes(d.status)) throw conflict("DEAL_NOT_SETTLEABLE", `Deal is ${d.status}; settle after the buyer accepts delivery`);
    if ([...this.settlements.values()].some((s) => s.dealId === dealId)) throw conflict("SETTLEMENT_EXISTS", "A settlement already exists for this deal");
    for (const x of deductions) if (!Number.isSafeInteger(x.amountPaise) || x.amountPaise < 0 || !x.type) throw invalid("INVALID_DEDUCTION", "Deductions need a type and non-negative integer paise");
    const card = currentCard(d);
    const delivered = [...d.events].reverse().find((e) => e.type === "DELIVERED");
    const accepted = String(delivered?.data?.actualQuantity ?? card.terms.quantity);
    if (compareQuantity(accepted, card.terms.quantity) > 0) {
      const tol = (Number(toMilli(card.terms.quantity)) * agg.tolerancePercent) / 100;
      if (Number(toMilli(accepted)) - Number(toMilli(card.terms.quantity)) > tol) throw invalid("OVER_TOLERANCE", "Delivered quantity exceeds the agreed quantity plus tolerance");
    }
    const gross = estimateTotalPaise(accepted, card.terms.unitPricePaise);
    const deductionTotal = deductions.reduce((a, x) => a + x.amountPaise, 0);
    if (deductionTotal > gross) throw invalid("DEDUCTIONS_EXCEED_GROSS", "Deductions exceed the gross amount");
    // members are paid in proportion to what they contributed to the aggregate
    const weights = agg.contributions.map((c) => ({ id: c.memberLotId, weight: toMilli(c.quantity) }));
    const grossShares = apportion(gross, weights);
    const dedShares = apportion(deductionTotal, weights);
    const qtyShares = apportion(Number(toMilli(accepted)), weights);
    const lines: SettlementLine[] = agg.contributions.map((c) => {
      const g = grossShares.get(c.memberLotId) as number, dd = dedShares.get(c.memberLotId) as number;
      return { memberLotId: c.memberLotId, memberName: c.memberName, quantity: fromMilli(BigInt(qtyShares.get(c.memberLotId) as number)), grossPaise: g, deductionPaise: dd, netPaise: g - dd };
    });
    if (lines.some((l) => l.netPaise < 0)) throw invalid("NEGATIVE_PAYABLE", "A member payable would be negative");
    const s: Settlement = { settlementId: uid("set"), dealId, aggregateLotId: agg.aggregateLotId, organizationId: agg.organizationId, status: "DRAFT", acceptedQuantity: accepted, unitPricePaise: card.terms.unitPricePaise, grossPaise: gross, deductions, deductionTotalPaise: deductionTotal, netPaise: gross - deductionTotal, lines, createdBy: user.userId, approvedBy: undefined, approvedAt: undefined, createdAt: this.p.iso(), version: 1 };
    this.settlements.set(s.settlementId, s);
    return s;
  }
  /** Policy: approval needs a different OWNER/FINANCE manager than the drafter (when one exists). */
  approveSettlement(user: User, settlementId: string): Settlement {
    const s = this.settlements.get(settlementId) ?? (() => { throw notFound("Settlement"); })();
    const org = this.fpoManager(user, s.organizationId, ["OWNER", "FINANCE"]);
    if (s.status !== "DRAFT") throw conflict("INVALID_TRANSITION", `Settlement is ${s.status}`);
    const approvers = org.members.filter((m) => m.role === "OWNER" || m.role === "FINANCE");
    if (s.createdBy === user.userId && approvers.length > 1) throw forbidden("A second manager must approve this settlement");
    s.status = "APPROVED"; s.approvedBy = user.userId; s.approvedAt = this.p.iso(); s.version++;
    this.p.event(this.p.getDeal(s.dealId), "SETTLEMENT_APPROVED", user.userId, { settlementId });
    this.p.log(user.userId, "SETTLEMENT_APPROVED", settlementId);
    return s;
  }
  exportSettlementCsv(user: User, settlementId: string): string {
    const s = this.settlements.get(settlementId) ?? (() => { throw notFound("Settlement"); })();
    this.fpoManager(user, s.organizationId, ["OWNER", "FINANCE"]);
    if (s.status !== "APPROVED") throw conflict("NOT_APPROVED", "Only approved settlements can be exported");
    const csv = (v: string | number) => { const t = String(v).replace(/^([=+\-@])/, "'$1"); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
    const rupees = (p: number) => `${Math.floor(p / 100)}.${String(p % 100).padStart(2, "0")}`;
    const rows = [["settlementId", "dealId", "member", "memberLotId", "quantity", "gross_inr", "deductions_inr", "net_inr"].join(",")];
    for (const l of s.lines) rows.push([s.settlementId, s.dealId, l.memberName, l.memberLotId, l.quantity, rupees(l.grossPaise), rupees(l.deductionPaise), rupees(l.netPaise)].map(csv).join(","));
    rows.push(["TOTAL", s.dealId, "", "", s.acceptedQuantity, rupees(s.grossPaise), rupees(s.deductionTotalPaise), rupees(s.netPaise)].map(csv).join(","));
    this.p.log(user.userId, "SETTLEMENT_EXPORTED", settlementId);
    return rows.join("\n") + "\n";
  }

  // ---- media uploads -----------------------------------------------------
  private sign(mediaId: string, exp: number) { return createHmac("sha256", this.uploadSecret).update(`${mediaId}.${exp}`).digest("base64url"); }
  /** Step 1: client asks for an upload destination; nothing is attached or served yet. */
  createUploadIntent(user: User, input: { purpose: Media["purpose"]; contentType: string; sizeBytes: number; refId?: string }) {
    const lim = MEDIA_LIMITS[input.contentType];
    if (!lim) throw invalid("UNSUPPORTED_TYPE", "Allowed types: " + Object.keys(MEDIA_LIMITS).join(", "));
    if (!Number.isInteger(input.sizeBytes) || input.sizeBytes <= 0 || input.sizeBytes > lim.maxBytes) throw invalid("SIZE_NOT_ALLOWED", `Size must be 1..${lim.maxBytes} bytes`);
    if (input.purpose === "LOT_PHOTO") {
      if (!input.refId) throw invalid("REF_REQUIRED", "refId (sellLotId) is required");
      this.p.ownLot(user, input.refId);
      if (input.contentType === "application/pdf") throw invalid("UNSUPPORTED_TYPE", "Lot photos must be images");
    }
    if (input.purpose === "DEAL_EVIDENCE") { if (!input.refId) throw invalid("REF_REQUIRED", "refId (dealId) is required"); this.p.dealParty(user, input.refId); }
    const exp = this.p.now().getTime() + 15 * 60_000;
    const m: Media = { mediaId: uid("media"), ownerId: user.userId, purpose: input.purpose, refId: input.refId, contentType: input.contentType, declaredBytes: input.sizeBytes, actualBytes: undefined, status: "PENDING_UPLOAD", rejectionReason: undefined, sha256: undefined, createdAt: this.p.iso(), expiresAt: new Date(exp).toISOString() };
    this.media.set(m.mediaId, m);
    return { mediaId: m.mediaId, uploadUrl: `${this.baseUrl}/v1/uploads/${m.mediaId}?exp=${exp}&sig=${this.sign(m.mediaId, exp)}`, expiresAt: m.expiresAt, method: "PUT" as const };
  }
  /** Step 2: direct upload to private storage using the short-lived signature (no session). */
  async receiveUpload(mediaId: string, exp: number, sig: string, bytes: Uint8Array): Promise<Media> {
    const want = Buffer.from(this.sign(mediaId, exp));
    const given = Buffer.from(sig);
    if (given.length !== want.length || !timingSafeEqual(given, want) || exp < this.p.now().getTime()) throw new DomainError("UPLOAD_FORBIDDEN", 403, "Upload link is invalid or expired");
    const m = this.media.get(mediaId) ?? (() => { throw notFound("Media"); })();
    if (m.status !== "PENDING_UPLOAD") throw conflict("ALREADY_UPLOADED", "This upload slot was already used");
    if (bytes.length === 0 || bytes.length > m.declaredBytes) throw invalid("SIZE_MISMATCH", "Uploaded size does not match the declared size");
    await this.blobs.put(`private/${mediaId}`, bytes);
    m.actualBytes = bytes.length; m.status = "UPLOADED";
    return m;
  }
  /** Step 3 (worker): content sniffing, size and signature checks before anything is attached or served. */
  async scanMedia(mediaId: string): Promise<Media> {
    const m = this.media.get(mediaId) ?? (() => { throw notFound("Media"); })();
    if (m.status !== "UPLOADED") return m;
    const bytes = await this.blobs.get(`private/${mediaId}`);
    const lim = MEDIA_LIMITS[m.contentType] as (typeof MEDIA_LIMITS)[string];
    const reject = async (reason: string) => { m.status = "REJECTED"; m.rejectionReason = reason; await this.blobs.delete(`private/${mediaId}`); return m; };
    if (!bytes) return reject("MISSING_OBJECT");
    if (!lim.magic.some((sig) => sig.every((b, i) => bytes[i] === b))) return reject("CONTENT_TYPE_MISMATCH");
    if (m.contentType === "image/webp" && Buffer.from(bytes.slice(8, 12)).toString("ascii") !== "WEBP") return reject("CONTENT_TYPE_MISMATCH");
    const head = Buffer.from(bytes.slice(0, Math.min(bytes.length, 65536))).toString("latin1");
    if (m.contentType === "application/pdf" && /\/(JavaScript|JS|Launch|EmbeddedFile)\b/.test(head + Buffer.from(bytes.slice(-4096)).toString("latin1"))) return reject("ACTIVE_CONTENT");
    if (/<\s*script|<\?php|MZ\x90\x00/i.test(head)) return reject("ACTIVE_CONTENT");
    m.sha256 = (await import("node:crypto")).createHash("sha256").update(bytes).digest("hex");
    m.status = "APPROVED";
    if (m.purpose === "LOT_PHOTO" && m.refId) { const lot = this.p.lots.get(m.refId); if (lot) { lot.photoCount++; lot.version++; } }
    if (m.purpose === "DEAL_EVIDENCE" && m.refId) {
      const d = this.p.deals.get(m.refId);
      if (d) { const ev = { evidenceId: uid("ev"), ownerId: m.ownerId, dealId: d.dealId, kind: "MEDIA", visibleTo: [d.sellerId, d.buyerId], note: m.mediaId, at: this.p.iso(), sensitive: false }; this.p.evidence.set(ev.evidenceId, ev); }
    }
    return m;
  }
  async scanPending(): Promise<number> {
    let n = 0;
    for (const m of [...this.media.values()]) if (m.status === "UPLOADED") { await this.scanMedia(m.mediaId); n++; }
    return n;
  }
  /** Unscanned/rejected files are never served to other users; verification documents only to their owner. */
  async readMedia(user: User, mediaId: string): Promise<{ media: Media; bytes: Uint8Array }> {
    const m = this.media.get(mediaId) ?? (() => { throw notFound("Media"); })();
    const owner = m.ownerId === user.userId;
    if (m.status !== "APPROVED" && !owner) throw notFound("Media");
    if (!owner) {
      let allowed = false;
      if (m.purpose === "LOT_PHOTO") allowed = true; // approved lot photos are part of the public lot view
      if (m.purpose === "DEAL_EVIDENCE" && m.refId) { const d = this.p.deals.get(m.refId); allowed = !!d && (d.sellerId === user.userId || d.buyerId === user.userId); }
      if (!allowed) throw notFound("Media");
    }
    const bytes = await this.blobs.get(`private/${mediaId}`);
    if (!bytes) throw notFound("Media");
    return { media: m, bytes };
  }
  /** Retention: abandoned upload slots are removed. */
  async purgeExpiredUploads(): Promise<number> {
    let n = 0;
    for (const m of [...this.media.values()]) if (m.status === "PENDING_UPLOAD" && Date.parse(m.expiresAt) < this.p.now().getTime()) { this.media.delete(m.mediaId); await this.blobs.delete(`private/${m.mediaId}`); n++; }
    return n;
  }
}
