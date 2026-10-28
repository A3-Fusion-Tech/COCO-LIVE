import {
  DomainError, addQuantity, assertOfferAcceptable, availableQuantity, compareQuantity, conflict, forbidden, invalid, notFound, totalForTerms, validateOfferTerms,
  type BuyRequirement, type Deal, type Offer, type OfferTerms,
} from "@livecoco/domain";
import { C, L } from "../../core/collections.ts";
import { uid } from "../../core/ids.ts";
import { orNotFound, type Scope } from "../../core/scope.ts";
import type { AuditLog } from "../../core/audit.ts";
import type { Notifier } from "../../core/notifier.ts";
import type { IdentityService } from "../identity/identity.service.ts";
import type { User } from "../identity/identity.types.ts";
import type { DealsService } from "../deals/deals.service.ts";
import type { LotsService } from "./lots.service.ts";
import type { RequirementsService } from "./requirements.service.ts";

export interface Thread { threadId: string; sellLotId: string; sellerId: string; buyerId: string; offerIds: string[]; contactRevealed: boolean }
interface Reveal { at: number; by: string; of: string; reason: string }

const freezeTerms = (o: Offer) => { Object.freeze(o.terms); return o; };

/** Offers and counter-offers in negotiation threads, acceptance into a deal, and gated contact reveal. */
export class OffersService {
  private readonly identity: IdentityService;
  private readonly lots: LotsService;
  private readonly requirements: RequirementsService;
  private readonly deals: DealsService;
  private readonly audit: AuditLog;
  private readonly notifier: Notifier;
  private readonly contactRevealPerDay: number;

  constructor(identity: IdentityService, lots: LotsService, requirements: RequirementsService, deals: DealsService, audit: AuditLog, notifier: Notifier, contactRevealPerDay: number) {
    this.identity = identity;
    this.lots = lots;
    this.requirements = requirements;
    this.deals = deals;
    this.audit = audit;
    this.notifier = notifier;
    this.contactRevealPerDay = contactRevealPerDay;
  }

  async get(s: Scope, id: string) { return freezeTerms(orNotFound(await s.tx.get<Offer>(C.offers, id), "Offer")); }
  private save(s: Scope, o: Offer) { return s.tx.put(C.offers, o.offerId, o); }

  private async asParty(s: Scope, id: string) {
    const o = await this.get(s, id);
    if (s.user.userId !== o.sellerId && s.user.userId !== o.buyerId) throw notFound("Offer");
    return o;
  }

  async mine(s: Scope) {
    const me = s.user.userId;
    const rows = [...(await s.tx.find<Offer>(C.offers, { sellerId: me })), ...(await s.tx.find<Offer>(C.offers, { buyerId: me }))];
    return [...new Map(rows.map((o) => [o.offerId, freezeTerms(o)])).values()];
  }

  async create(s: Scope, input: { sellLotId: string; requirementId?: string; terms: OfferTerms; expiresAt: string }): Promise<Offer> {
    const buyer = s.user;
    const lot = await this.lots.get(s, input.sellLotId);
    if (lot.sellerId === buyer.userId) throw forbidden("Cannot offer on your own lot");
    if (!(await this.identity.isVerifiedParty(s, buyer.userId))) throw forbidden("Buyer verification required to make offers");
    if (!["ACTIVE", "RESERVED"].includes(lot.status) || Date.parse(lot.expiresAt) <= s.ms()) throw conflict("LOT_NOT_AVAILABLE", "Lot is not accepting offers");
    if ((await this.identity.user(s, lot.sellerId))?.blocked.includes(buyer.userId) || buyer.blocked.includes(lot.sellerId)) throw notFound("Sell lot");
    if (input.requirementId && (await this.requirements.get(s, input.requirementId)).buyerId !== buyer.userId) throw forbidden();
    const issues = validateOfferTerms(input.terms, lot, input.expiresAt, s.now());
    if (issues.length) throw invalid("OFFER_INVALID", issues.join(", "));
    const thread = (await s.tx.find<Thread>(C.threads, { sellLotId: lot.sellLotId, buyerId: buyer.userId }))[0] ?? { threadId: uid("neg"), sellLotId: lot.sellLotId, sellerId: lot.sellerId, buyerId: buyer.userId, offerIds: [], contactRevealed: false };
    for (const id of thread.offerIds) if ((await s.tx.get<Offer>(C.offers, id))?.status === "ACTIVE") throw conflict("ACTIVE_OFFER_EXISTS", "There is already an active offer in this negotiation");
    const o: Offer = {
      offerId: uid("offer"), threadId: thread.threadId, revision: thread.offerIds.length + 1, previousOfferId: thread.offerIds[thread.offerIds.length - 1], sellLotId: lot.sellLotId,
      requirementId: input.requirementId, createdByPartyId: buyer.userId, sellerId: lot.sellerId, buyerId: buyer.userId, terms: Object.freeze({ ...input.terms }),
      estimatedTotalPaise: totalForTerms(input.terms), expiresAt: input.expiresAt, status: "ACTIVE", version: 1, createdAt: s.iso(),
    };
    thread.offerIds.push(o.offerId);
    s.tx.put(C.threads, thread.threadId, thread);
    this.save(s, o);
    await this.notifier.notify(s, lot.sellerId, "SMS", "offer.received", { offerId: o.offerId }, `offer:${o.offerId}`);
    return o;
  }

  async counter(s: Scope, offerId: string, terms: OfferTerms, expiresAt: string, expectedVersion?: number): Promise<Offer> {
    const user = s.user;
    const prev = await this.asParty(s, offerId);
    if (expectedVersion !== undefined && expectedVersion !== prev.version) throw conflict("VERSION_CONFLICT", "The resource was changed by someone else");
    assertOfferAcceptable(prev, s.now());
    if (prev.createdByPartyId === user.userId) throw forbidden("Cannot counter your own offer");
    const issues = validateOfferTerms(terms, await this.lots.get(s, prev.sellLotId), expiresAt, s.now());
    if (issues.length) throw invalid("OFFER_INVALID", issues.join(", "));
    this.save(s, { ...prev, status: "COUNTERED", version: prev.version + 1 });
    const thread = orNotFound(await s.tx.get<Thread>(C.threads, prev.threadId), "Thread");
    const o: Offer = { ...prev, offerId: uid("offer"), revision: prev.revision + 1, previousOfferId: prev.offerId, createdByPartyId: user.userId, terms: Object.freeze({ ...terms }), estimatedTotalPaise: totalForTerms(terms), expiresAt, status: "ACTIVE", version: 1, createdAt: s.iso() };
    thread.offerIds.push(o.offerId);
    s.tx.put(C.threads, thread.threadId, thread);
    this.save(s, o);
    await this.notifier.notify(s, user.userId === prev.sellerId ? prev.buyerId : prev.sellerId, "SMS", "offer.countered", { offerId: o.offerId }, `offer:${o.offerId}`);
    return o;
  }

  async reject(s: Scope, offerId: string) {
    const o = await this.asParty(s, offerId);
    assertOfferAcceptable(o, s.now());
    if (o.createdByPartyId === s.user.userId) throw forbidden("Use withdraw for your own offer");
    return this.save(s, { ...o, status: "REJECTED", version: o.version + 1 });
  }

  async withdraw(s: Scope, offerId: string) {
    const o = await this.asParty(s, offerId);
    if (o.createdByPartyId !== s.user.userId) throw forbidden();
    assertOfferAcceptable(o, s.now());
    return this.save(s, { ...o, status: "WITHDRAWN", version: o.version + 1 });
  }

  /**
   * Acceptance reserves lot quantity and creates the deal in one unit of work. The lot row is locked for the
   * duration, so two acceptances against the same lot serialise and the second sees the first's reservation.
   */
  async accept(s: Scope, offerId: string, expectedVersion?: number): Promise<Deal> {
    const user = s.user;
    const o = await this.asParty(s, offerId);
    if (expectedVersion !== undefined && expectedVersion !== o.version) throw conflict("VERSION_CONFLICT", "The resource was changed by someone else");
    if (o.createdByPartyId === user.userId) throw forbidden("Cannot accept your own offer");
    assertOfferAcceptable(o, s.now());
    const lot = await this.lots.get(s, o.sellLotId);
    if (!["ACTIVE", "RESERVED"].includes(lot.status)) throw conflict("LOT_NOT_AVAILABLE", "Lot is no longer available");
    if (compareQuantity(o.terms.quantity, availableQuantity(lot)) > 0) throw conflict("INSUFFICIENT_QUANTITY", "Another acceptance has already reserved this quantity");
    if ((await this.identity.user(s, lot.sellerId))?.suspended) throw conflict("PARTICIPANT_SUSPENDED", "Counterparty unavailable");
    const accepted = this.save(s, { ...o, status: "ACCEPTED", version: o.version + 1 });
    lot.quantityReserved = addQuantity(lot.quantityReserved, o.terms.quantity);
    lot.status = "RESERVED"; // any remainder stays discoverable through the RESERVED + available-quantity rule
    this.lots.touch(s, lot);
    const remaining = availableQuantity(lot);
    for (const other of await this.lots.activeOffers(s, lot.sellLotId)) {
      if (other.offerId !== o.offerId && compareQuantity(other.terms.quantity, remaining) > 0) this.save(s, { ...other, status: "INVALIDATED", version: other.version + 1 });
    }
    if (o.requirementId) {
      const r = await s.tx.get<BuyRequirement>(C.requirements, o.requirementId);
      if (r) {
        r.fulfilledQuantity = addQuantity(r.fulfilledQuantity, o.terms.quantity);
        if (compareQuantity(r.fulfilledQuantity, r.targetQuantity) >= 0) { r.status = "FILLED"; r.version++; }
        this.requirements.save(s, r);
      }
    }
    const deal = this.deals.createFromOffer(s, accepted, lot);
    this.audit.record(s, user.userId, "OFFER_ACCEPTED", o.offerId, undefined, { dealId: deal.dealId });
    return deal;
  }

  async expire(s: Scope) {
    let n = 0;
    for (const o of await s.tx.find<Offer>(C.offers, { status: "ACTIVE" })) if (Date.parse(o.expiresAt) <= s.ms()) { this.save(s, { ...o, status: "EXPIRED", version: o.version + 1 }); n++; }
    return n;
  }

  // ---- contact reveal ------------------------------------------------------------------------
  /** Phone numbers are revealed only on mutual interest (accepted offer, or both sides have made an offer), with a daily cap. */
  async revealContact(s: Scope, threadId: string, reason = "NEGOTIATION"): Promise<{ phone: string }> {
    const user = s.user;
    const t = await s.tx.get<Thread>(C.threads, threadId);
    if (!t || (t.sellerId !== user.userId && t.buyerId !== user.userId)) throw notFound("Thread");
    const dayAgo = s.ms() - 86_400_000;
    if ((await s.tx.findLog<Reveal>(L.reveals, { by: user.userId })).filter((r) => r.at > dayAgo).length >= this.contactRevealPerDay) throw new DomainError("RATE_LIMITED", 429, "Contact reveal limit reached", "error.rate_limited");
    const offers: Offer[] = [];
    for (const id of t.offerIds) { const o = await s.tx.get<Offer>(C.offers, id); if (o) offers.push(o); }
    const mutual = offers.some((o) => o.status === "ACCEPTED") || new Set(offers.map((o) => o.createdByPartyId)).size === 2;
    if (!mutual) throw forbidden("Contact reveal requires mutual interest");
    const otherId = user.userId === t.sellerId ? t.buyerId : t.sellerId;
    const other = orNotFound(await s.tx.get<User>(C.users, otherId), "User");
    if (other.suspended || other.blocked.includes(user.userId) || user.blocked.includes(otherId)) throw forbidden();
    s.tx.append(L.reveals, { at: s.ms(), by: user.userId, of: otherId, reason } satisfies Reveal);
    s.tx.put(C.threads, threadId, { ...t, contactRevealed: true });
    this.audit.record(s, user.userId, "CONTACT_REVEALED", otherId, reason, { threadId });
    return { phone: other.phone };
  }
}
