import {
  DISPUTE_RESPONSE_HOURS, MATERIAL_TERM_FIELDS, addQuantity, assertDealTransition, availableQuantity, compareQuantity, conflict, currentCard, forbidden, invalid, notFound,
  subtractQuantity, toMilli, totalForTerms,
  type Deal, type DealEventType, type Dispute, type DisputeOutcome, type DisputeReason, type Offer, type OfferTerms, type SellLot,
} from "@livecoco/domain";
import { C } from "../../core/collections.ts";
import { uid } from "../../core/ids.ts";
import { orNotFound, type Scope } from "../../core/scope.ts";
import type { AuditLog, WorkQueue } from "../../core/audit.ts";
import type { Notifier } from "../../core/notifier.ts";
import type { IdentityService } from "../identity/identity.service.ts";
import type { Evidence } from "../identity/identity.types.ts";
import type { LotsService } from "../marketplace/lots.service.ts";
import type { Reputation } from "../marketplace/participants.ts";

const HOUR = 3_600_000;
const CLOSED = ["COMPLETED", "CANCELLED", "DISPUTED"];

/** Deal cards and events are immutable history: frozen in memory and guarded by triggers in Postgres. */
function freezeDeal(d: Deal) {
  const deep = (o: object) => { Object.freeze(o); for (const v of Object.values(o)) if (v && typeof v === "object" && !Object.isFrozen(v)) deep(v); };
  d.cards.forEach(deep);
  d.events.forEach(deep);
  return d;
}

/**
 * Deals from acceptance to completion: the Deal Card and its amendments, fulfilment milestones, cancellation,
 * deal evidence and disputes. Every change is recorded as an immutable deal event.
 */
export class DealsService {
  private readonly identity: IdentityService;
  private readonly lots: LotsService;
  private readonly reputation: Reputation;
  private readonly audit: AuditLog;
  private readonly queue: WorkQueue;
  private readonly notifier: Notifier;

  constructor(identity: IdentityService, lots: LotsService, reputation: Reputation, audit: AuditLog, queue: WorkQueue, notifier: Notifier) {
    this.identity = identity;
    this.lots = lots;
    this.reputation = reputation;
    this.audit = audit;
    this.queue = queue;
    this.notifier = notifier;
  }

  async find(s: Scope, id: string) { const d = await s.tx.get<Deal>(C.deals, id); return d && freezeDeal(d); }
  async get(s: Scope, id: string) { return orNotFound(await this.find(s, id), "Deal"); }
  save(s: Scope, d: Deal) { return s.tx.put(C.deals, d.dealId, d); }

  /** The deal, if the actor is one of its parties (otherwise NOT_FOUND). */
  async asParty(s: Scope, id: string) {
    const d = await this.get(s, id);
    if (d.sellerId !== s.user.userId && d.buyerId !== s.user.userId) throw notFound("Deal");
    return d;
  }

  /** Parties see their deals; dispute operators see disputed ones. */
  async view(s: Scope, id: string) {
    const d = await this.get(s, id);
    if (d.sellerId === s.user.userId || d.buyerId === s.user.userId) return d;
    if (d.disputeId) { this.identity.require(s, "ops.disputes"); return d; }
    throw notFound("Deal");
  }

  async mine(s: Scope) {
    const uid_ = s.user.userId;
    const rows = [...(await s.tx.find<Deal>(C.deals, { sellerId: uid_ })), ...(await s.tx.find<Deal>(C.deals, { buyerId: uid_ }))];
    return [...new Map(rows.map((d) => [d.dealId, freezeDeal(d)])).values()];
  }

  event(s: Scope, d: Deal, type: DealEventType, actorId: string, data?: Record<string, unknown>) {
    d.events.push(Object.freeze({ seq: d.events.length + 1, type, actorId, at: s.iso(), ...(data ? { data } : {}) }) as Deal["events"][number]);
    d.version++;
    this.save(s, d);
  }

  move(s: Scope, d: Deal, to: Deal["status"], type: DealEventType, actorId: string, data?: Record<string, unknown>) {
    assertDealTransition(d.status, to);
    d.status = to;
    this.event(s, d, type, actorId, data);
  }

  /** Called by offer acceptance, in the same unit of work that reserved the lot quantity. */
  createFromOffer(s: Scope, o: Offer, lot: SellLot): Deal {
    const deal: Deal = { dealId: uid("deal"), sellLotId: lot.sellLotId, requirementId: o.requirementId, sellerId: o.sellerId, buyerId: o.buyerId, status: "AGREED", cards: [], events: [], pendingAmendment: undefined, deliveredAt: undefined, disputeId: undefined, version: 1 };
    deal.cards.push(Object.freeze({
      revision: 1, terms: o.terms, totalPaise: o.estimatedTotalPaise, offerId: o.offerId,
      lotSnapshot: Object.freeze({ productId: lot.productId, gradeAttributes: { ...lot.gradeAttributes }, originMarketId: lot.originMarketId }),
      createdAt: s.iso(), acceptedBy: [o.createdByPartyId, s.user.userId], deemedAcceptanceAgreed: true,
    }) as Deal["cards"][number]);
    this.event(s, deal, "DEAL_CREATED", s.user.userId, { offerId: o.offerId });
    return freezeDeal(deal);
  }

  // ---- amendments ----------------------------------------------------------------------------
  /** Any amendment needs the counterparty's acceptance; material ones are flagged as such. */
  async proposeAmendment(s: Scope, dealId: string, terms: OfferTerms) {
    const d = await this.asParty(s, dealId);
    if (CLOSED.includes(d.status)) throw conflict("DEAL_CLOSED", `Deal is ${d.status}`);
    if (d.pendingAmendment) throw conflict("AMENDMENT_PENDING", "An amendment is already pending");
    const cur = currentCard(d).terms;
    const changed = (Object.keys(terms) as (keyof OfferTerms)[]).filter((k) => JSON.stringify(cur[k]) !== JSON.stringify(terms[k]));
    if (!changed.length) throw invalid("NO_CHANGE", "Amendment changes nothing");
    if (terms.quantity !== cur.quantity) {
      const lot = await this.lots.get(s, d.sellLotId);
      if (compareQuantity(terms.quantity, addQuantity(availableQuantity(lot), cur.quantity)) > 0) throw conflict("INSUFFICIENT_QUANTITY", "Not enough quantity for amendment");
    }
    d.pendingAmendment = { terms, proposedBy: s.user.userId };
    this.event(s, d, "AMENDMENT_PROPOSED", s.user.userId, { changed, material: changed.some((k) => MATERIAL_TERM_FIELDS.includes(k)) });
    return d;
  }

  async respondAmendment(s: Scope, dealId: string, accept: boolean) {
    const d = await this.asParty(s, dealId);
    const p = d.pendingAmendment;
    if (!p) throw conflict("NO_PENDING_AMENDMENT", "No amendment pending");
    if (p.proposedBy === s.user.userId) throw forbidden("The proposer cannot accept their own amendment");
    d.pendingAmendment = undefined;
    if (!accept) { this.event(s, d, "AMENDMENT_REJECTED", s.user.userId); return d; }
    const prev = currentCard(d);
    const lot = await this.lots.get(s, d.sellLotId);
    lot.quantityReserved = addQuantity(subtractQuantity(lot.quantityReserved, prev.terms.quantity), p.terms.quantity);
    this.lots.touch(s, lot);
    d.cards.push(Object.freeze({ ...prev, revision: prev.revision + 1, terms: Object.freeze({ ...p.terms }), totalPaise: totalForTerms(p.terms), createdAt: s.iso(), acceptedBy: [p.proposedBy, s.user.userId] }) as Deal["cards"][number]);
    this.event(s, d, "AMENDMENT_ACCEPTED", s.user.userId, { revision: prev.revision + 1 });
    return d;
  }

  // ---- milestones ----------------------------------------------------------------------------
  async confirmPickup(s: Scope, dealId: string) {
    const d = await this.asParty(s, dealId);
    if (d.pendingAmendment) throw conflict("AMENDMENT_PENDING", "Resolve the pending amendment first");
    this.move(s, d, "PICKUP_CONFIRMED", "PICKUP_CONFIRMED", s.user.userId);
    return d;
  }

  async confirmDelivery(s: Scope, dealId: string, actualQuantity?: string) {
    const d = await this.asParty(s, dealId);
    const terms = currentCard(d).terms;
    if (s.user.userId !== d.sellerId && terms.fulfilmentMode === "DELIVERY") throw forbidden("Delivery is confirmed by the seller");
    d.deliveredAt = s.iso();
    this.move(s, d, "DELIVERED", "DELIVERED", s.user.userId, { actualQuantity: actualQuantity ?? terms.quantity });
    this.reputation.record(s, d.sellerId, s.ms() <= Date.parse(terms.fulfilmentBy) ? "ON_TIME" : "LATE", dealId);
    return d;
  }

  async acceptDelivery(s: Scope, dealId: string) {
    const d = await this.asParty(s, dealId);
    if (s.user.userId !== d.buyerId) throw forbidden("Only the buyer accepts delivery");
    this.move(s, d, "ACCEPTED", "BUYER_ACCEPTED", s.user.userId);
    this.reputation.record(s, d.sellerId, "QUANTITY_ACCEPTED_FULL", dealId);
    return d;
  }

  /** Confirmation only: LiveCoco never holds or guarantees payment (ADR-006). */
  async confirmPayment(s: Scope, dealId: string, method: string) {
    const d = await this.asParty(s, dealId);
    if (s.user.userId !== d.sellerId) throw forbidden("Payment is confirmed by the receiving seller");
    this.move(s, d, "PAYMENT_CONFIRMED", "PAYMENT_CONFIRMED", s.user.userId, { method, guarantee: false });
    this.reputation.record(s, d.buyerId, "PAYMENT_ON_TIME", dealId);
    return d;
  }

  async complete(s: Scope, dealId: string) {
    const d = await this.asParty(s, dealId);
    if (d.disputeId && (await s.tx.get<Dispute>(C.disputes, d.disputeId))?.status !== "RESOLVED") throw conflict("DISPUTE_OPEN", "Resolve the dispute first");
    this.move(s, d, "COMPLETED", "COMPLETED", s.user.userId);
    const lot = await this.lots.get(s, d.sellLotId);
    if (compareQuantity(lot.quantityReserved, lot.quantityTotal) >= 0) { lot.status = "SOLD"; this.lots.touch(s, lot); }
    for (const p of [d.sellerId, d.buyerId]) this.reputation.record(s, p, "DEAL_COMPLETED", dealId);
    return d;
  }

  /** Gives a cancelled deal's quantity back to its lot. */
  async releaseReservation(s: Scope, d: Deal) {
    const lot = await this.lots.get(s, d.sellLotId);
    lot.quantityReserved = subtractQuantity(lot.quantityReserved, currentCard(d).terms.quantity);
    if (lot.status !== "SOLD") lot.status = toMilli(lot.quantityReserved) === 0n ? "ACTIVE" : "RESERVED";
    this.lots.touch(s, lot);
  }

  async cancel(s: Scope, dealId: string, reason: string) {
    const d = await this.asParty(s, dealId);
    if (!reason) throw invalid("REASON_REQUIRED", "A cancellation reason is required");
    this.move(s, d, "CANCELLED", "CANCELLED", s.user.userId, { reason });
    await this.releaseReservation(s, d);
    this.reputation.record(s, s.user.userId, "CANCELLED_BY_PARTY", dealId);
    return d;
  }

  /** Deemed acceptance once the agreed acceptance window after delivery passes without a dispute. */
  async applyDeemedAcceptance(s: Scope) {
    let n = 0;
    for (const d of await s.tx.find<Deal>(C.deals, { status: "DELIVERED" })) {
      freezeDeal(d);
      const card = currentCard(d);
      if (card.deemedAcceptanceAgreed && d.deliveredAt && !d.disputeId && s.ms() >= Date.parse(d.deliveredAt) + card.terms.acceptanceWindowHours * HOUR) {
        this.move(s, d, "ACCEPTED", "DEEMED_ACCEPTED", "system");
        n++;
      }
    }
    return n;
  }

  // ---- evidence ------------------------------------------------------------------------------
  async addEvidence(s: Scope, dealId: string, kind: string, note: string): Promise<Evidence> {
    const d = await this.asParty(s, dealId);
    const e = this.identity.addEvidence(s, { ownerId: s.user.userId, dealId, kind, visibleTo: [d.sellerId, d.buyerId], note, sensitive: false });
    this.event(s, d, "EVIDENCE_ADDED", s.user.userId, { evidenceId: e.evidenceId, kind });
    return e;
  }

  async evidence(s: Scope, dealId: string): Promise<Evidence[]> {
    const d = await this.get(s, dealId);
    if (d.sellerId !== s.user.userId && d.buyerId !== s.user.userId) {
      if (!d.disputeId) throw notFound("Deal");
      this.identity.require(s, "ops.disputes");
      this.audit.record(s, s.user.userId, "DEAL_EVIDENCE_VIEWED", dealId);
    }
    return this.identity.evidenceForDeal(s, dealId);
  }

  // ---- disputes ------------------------------------------------------------------------------
  async dispute(s: Scope, id: string) { return orNotFound(await s.tx.get<Dispute>(C.disputes, id), "Dispute"); }

  async openDispute(s: Scope, dealId: string, input: { reason: DisputeReason; claimedQuantity?: string; claimedAmountPaise?: number; evidenceIds?: string[] }): Promise<Dispute> {
    const user = s.user;
    const d = await this.asParty(s, dealId);
    if (d.disputeId) throw conflict("DISPUTE_EXISTS", "A dispute already exists for this deal");
    const windowEnds = d.deliveredAt ? Date.parse(d.deliveredAt) + currentCard(d).terms.acceptanceWindowHours * HOUR : Infinity;
    const anytime: DisputeReason[] = ["NON_PAYMENT", "NO_SHOW", "DELIVERY_FAILURE"];
    if (!anytime.includes(input.reason) && s.ms() > windowEnds) throw conflict("DISPUTE_WINDOW_CLOSED", "The acceptance window has closed");
    if (["COMPLETED", "CANCELLED"].includes(d.status)) throw conflict("DEAL_CLOSED", `Deal is ${d.status}`);
    for (const id of input.evidenceIds ?? []) if (!(await this.identity.evidence(s, id))?.visibleTo.includes(user.userId)) throw invalid("EVIDENCE_NOT_FOUND", "Unknown evidence");
    const respondent = user.userId === d.sellerId ? d.buyerId : d.sellerId;
    const dis: Dispute = {
      disputeId: uid("dis"), dealId, openedBy: user.userId, respondent, reason: input.reason, claimedQuantity: input.claimedQuantity, claimedAmountPaise: input.claimedAmountPaise,
      evidenceIds: input.evidenceIds ?? [], status: "AWAITING_RESPONSE", responseDueAt: new Date(s.ms() + DISPUTE_RESPONSE_HOURS * HOUR).toISOString(), response: undefined, resolution: undefined, openedAt: s.iso(),
    };
    s.tx.put(C.disputes, dis.disputeId, dis);
    s.tx.put(C.disputeBefore, dis.disputeId, { status: d.status });
    d.disputeId = dis.disputeId;
    this.move(s, d, "DISPUTED", "DISPUTE_OPENED", user.userId, { disputeId: dis.disputeId, reason: input.reason });
    this.reputation.record(s, user.userId, "DISPUTE_OPENED", dealId);
    this.queue.enqueue(s, { queue: "DISPUTE", subject: dis.disputeId, summary: `Dispute: ${input.reason}`, reasons: [input.reason], priority: 1, requiredCapability: "ops.disputes" });
    await this.notifier.notify(s, respondent, "SMS", "dispute.opened", { disputeId: dis.disputeId, dueAt: dis.responseDueAt }, `dispute:${dis.disputeId}`);
    return dis;
  }

  async respondDispute(s: Scope, disputeId: string, text: string, evidenceIds: string[] = []) {
    const dis = await this.dispute(s, disputeId);
    if (dis.respondent !== s.user.userId) throw notFound("Dispute");
    if (dis.response) throw conflict("ALREADY_RESPONDED", "Response already recorded");
    if (s.ms() > Date.parse(dis.responseDueAt)) throw conflict("RESPONSE_WINDOW_CLOSED", "Response window closed");
    return s.tx.put(C.disputes, disputeId, { ...dis, response: { text, at: s.iso(), evidenceIds }, status: "UNDER_REVIEW" });
  }

  /** Operators see the Deal Card and events but cannot change them: the resolution is a separate, audited record. */
  async resolveDispute(s: Scope, disputeId: string, outcome: DisputeOutcome, reason: string) {
    this.identity.require(s, "ops.disputes");
    if (!reason) throw invalid("REASON_REQUIRED", "A resolution reason is required");
    const dis = await this.dispute(s, disputeId);
    if (dis.status === "RESOLVED") throw conflict("ALREADY_RESOLVED", "Dispute already resolved");
    if (dis.status === "AWAITING_RESPONSE" && s.ms() <= Date.parse(dis.responseDueAt)) throw conflict("RESPONSE_WINDOW_OPEN", "Counterparty response window is still open");
    const resolved = s.tx.put(C.disputes, disputeId, { ...dis, resolution: { outcome, reason, operatorId: s.user.userId, at: s.iso() }, status: "RESOLVED" as const });
    const d = await this.get(s, dis.dealId);
    const before = (await s.tx.get<{ status: Deal["status"] } | Deal["status"]>(C.disputeBefore, disputeId)) ?? "DELIVERED";
    const prior = typeof before === "string" ? before : before.status;
    const back = prior === "PAYMENT_CONFIRMED" ? "PAYMENT_CONFIRMED" : ["AGREED", "PICKUP_CONFIRMED"].includes(prior) ? "CANCELLED" : "ACCEPTED";
    this.move(s, d, back, "DISPUTE_RESOLVED", s.user.userId, { outcome });
    if (outcome === "UPHELD" || outcome === "PARTIALLY_UPHELD") this.reputation.record(s, dis.respondent, "DISPUTE_UPHELD_AGAINST", d.dealId);
    await this.queue.close(s, disputeId);
    this.audit.record(s, s.user.userId, "DISPUTE_RESOLVED", disputeId, reason, { outcome });
    return resolved;
  }

  async disputeForParty(s: Scope, id: string) {
    const dis = await s.tx.get<Dispute>(C.disputes, id);
    if (!dis || (dis.openedBy !== s.user.userId && dis.respondent !== s.user.userId)) throw notFound("Dispute");
    return dis;
  }

  async disputeForOperator(s: Scope, id: string) {
    this.identity.require(s, "ops.disputes");
    return this.dispute(s, id);
  }
}
