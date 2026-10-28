import {
  MARKETS, assertLotTransition, compareQuantity, conflict, invalid, notFound, isMaterialLotChange, publicLotView, toMilli, validateLotForActivation,
  type FulfilmentTerm, type Offer, type ProductId, type SellLot, type Unit,
} from "@livecoco/domain";
import { C } from "../../core/collections.ts";
import { uid } from "../../core/ids.ts";
import { orNotFound, type Scope } from "../../core/scope.ts";
import type { AuditLog, WorkQueue } from "../../core/audit.ts";
import type { Notifier } from "../../core/notifier.ts";
import type { IdentityService } from "../identity/identity.service.ts";
import type { Participants } from "./participants.ts";

export interface LotInput {
  organizationId?: string; listedOnBehalfOf?: string; productId: ProductId; gradeAttributes: Record<string, string>; gradeGroup: string; unit: Unit; quantityTotal: string;
  partialFulfilmentAllowed: boolean; originMarketId: string; preciseLocation?: { lat: number; lon: number }; availableFrom: string; availableTo: string; expiresAt: string;
  fulfilment: FulfilmentTerm; priceExpectation: SellLot["priceExpectation"]; photoCount?: number;
}
export type LotPatch = Partial<Pick<SellLot, "gradeAttributes" | "quantityTotal" | "expiresAt" | "availableFrom" | "availableTo" | "fulfilment" | "priceExpectation" | "partialFulfilmentAllowed" | "gradeGroup">>;

const DISCOVERABLE = ["ACTIVE", "RESERVED"] as const;

/** Seller lots: drafting, editing (with offer invalidation on material change), activation and review, withdrawal, discovery. */
export class LotsService {
  private readonly identity: IdentityService;
  private readonly participants: Participants;
  private readonly audit: AuditLog;
  private readonly queue: WorkQueue;
  private readonly notifier: Notifier;

  constructor(identity: IdentityService, participants: Participants, audit: AuditLog, queue: WorkQueue, notifier: Notifier) {
    this.identity = identity;
    this.participants = participants;
    this.audit = audit;
    this.queue = queue;
    this.notifier = notifier;
  }

  async get(s: Scope, id: string) { return orNotFound(await s.tx.get<SellLot>(C.lots, id), "Sell lot"); }
  save(s: Scope, l: SellLot) { return s.tx.put(C.lots, l.sellLotId, l); }
  /** Bumps the version and stages the write. */
  touch(s: Scope, l: SellLot) { l.version++; return this.save(s, l); }

  /** The lot, if the actor is its seller or a member of the listing organisation (otherwise NOT_FOUND). */
  async own(s: Scope, id: string) {
    const l = await this.get(s, id);
    if (l.sellerId !== s.user.userId && !(l.organizationId && (await this.identity.isMember(s, l.organizationId, s.user.userId)))) throw notFound("Sell lot");
    return l;
  }

  async create(s: Scope, input: LotInput): Promise<SellLot> {
    await this.identity.assertOrgMember(s, input.organizationId);
    if (!MARKETS[input.originMarketId]) throw invalid("UNKNOWN_MARKET", "Unknown origin market");
    toMilli(input.quantityTotal);
    const lot: SellLot = {
      sellLotId: uid("lot"), sellerId: s.user.userId, organizationId: input.organizationId, listedOnBehalfOf: input.listedOnBehalfOf, productId: input.productId, gradeAttributes: input.gradeAttributes,
      gradeGroup: input.gradeGroup, unit: input.unit, quantityTotal: input.quantityTotal, quantityReserved: "0", partialFulfilmentAllowed: input.partialFulfilmentAllowed, originMarketId: input.originMarketId,
      preciseLocation: input.preciseLocation, availableFrom: input.availableFrom, availableTo: input.availableTo, expiresAt: input.expiresAt, fulfilment: input.fulfilment,
      priceExpectation: input.priceExpectation, photoCount: input.photoCount ?? 0, photoExceptionReason: undefined, status: "DRAFT", version: 1, createdAt: s.iso(),
    };
    return this.save(s, lot);
  }

  mine(s: Scope) { return s.tx.find<SellLot>(C.lots, { sellerId: s.user.userId }); }

  async addPhoto(s: Scope, lotId: string) { const l = await this.own(s, lotId); l.photoCount++; return this.touch(s, l); }

  async grantPhotoException(s: Scope, lotId: string, reason: string) {
    this.identity.require(s, "ops.listings");
    if (!reason) throw invalid("REASON_REQUIRED", "A justification is required");
    const l = await this.get(s, lotId);
    l.photoExceptionReason = reason;
    this.audit.record(s, s.user.userId, "PHOTO_EXCEPTION", lotId, reason);
    return this.touch(s, l);
  }

  async update(s: Scope, lotId: string, patch: LotPatch, expectedVersion?: number) {
    const l = await this.own(s, lotId);
    if (expectedVersion !== undefined && expectedVersion !== l.version) throw conflict("VERSION_CONFLICT", "The resource was changed by someone else");
    if (["SOLD", "EXPIRED", "WITHDRAWN", "SUSPENDED"].includes(l.status)) throw conflict("LOT_NOT_EDITABLE", `Lot is ${l.status}`);
    if (patch.quantityTotal !== undefined && compareQuantity(patch.quantityTotal, l.quantityReserved) < 0) throw invalid("BELOW_RESERVED", "Quantity cannot be below the reserved amount");
    const material = isMaterialLotChange(patch) && Object.entries(patch).some(([k, v]) => JSON.stringify((l as unknown as Record<string, unknown>)[k]) !== JSON.stringify(v));
    Object.assign(l, patch);
    this.touch(s, l);
    if (material) {
      // Buyers made their offers against the old terms.
      for (const o of await this.activeOffers(s, lotId)) {
        s.tx.put(C.offers, o.offerId, { ...o, status: "INVALIDATED", version: o.version + 1 });
        await this.notifier.notify(s, o.buyerId, "SMS", "offer.invalidated", { offerId: o.offerId }, `inv:${o.offerId}`);
      }
      this.audit.record(s, s.user.userId, "LOT_REVISED", lotId, undefined, { version: l.version });
    }
    return { lot: l, materialRevision: material };
  }

  activeOffers(s: Scope, sellLotId: string) { return s.tx.find<Offer>(C.offers, { sellLotId, status: "ACTIVE" }); }

  /** New, unverified participants go to listing review instead of straight to ACTIVE. */
  async activate(s: Scope, lotId: string): Promise<SellLot> {
    const l = await this.own(s, lotId);
    const issues = validateLotForActivation(l, s.now());
    if (issues.length) throw invalid("LOT_INVALID", issues.join(", "));
    const established = (await this.identity.isVerifiedParty(s, s.user.userId)) || (await this.participants.state(s, s.user.userId)).completedDeals > 0;
    if (!established) {
      assertLotTransition(l.status, "PENDING_REVIEW");
      l.status = "PENDING_REVIEW";
      this.queue.enqueue(s, { queue: "LISTING_REVIEW", subject: l.sellLotId, summary: "New participant listing", reasons: ["NEW_PARTICIPANT"], priority: 2, requiredCapability: "ops.listings" });
      return this.touch(s, l);
    }
    assertLotTransition(l.status, "ACTIVE");
    l.status = "ACTIVE";
    return this.touch(s, l);
  }

  async review(s: Scope, lotId: string, decision: "APPROVE" | "SUSPEND" | "RETURN", reason: string) {
    this.identity.require(s, "ops.listings");
    if (!reason) throw invalid("REASON_REQUIRED", "A reason is required");
    const l = await this.get(s, lotId);
    const to = decision === "APPROVE" ? "ACTIVE" : decision === "SUSPEND" ? "SUSPENDED" : "DRAFT";
    assertLotTransition(l.status, to);
    l.status = to;
    await this.queue.close(s, lotId);
    this.audit.record(s, s.user.userId, `LISTING_${decision}`, lotId, reason);
    return this.touch(s, l);
  }

  async withdraw(s: Scope, lotId: string) {
    const l = await this.own(s, lotId);
    if (toMilli(l.quantityReserved) > 0n) throw conflict("LOT_RESERVED", "A reserved lot cannot be withdrawn");
    assertLotTransition(l.status, "WITHDRAWN");
    l.status = "WITHDRAWN";
    for (const o of await this.activeOffers(s, lotId)) s.tx.put(C.offers, o.offerId, { ...o, status: "INVALIDATED", version: o.version + 1 });
    return this.touch(s, l);
  }

  /** Lots that are open for offers: discoverable status, not expired. */
  async discoverable(s: Scope, f: { productId?: string } = {}) {
    const out: SellLot[] = [];
    for (const status of DISCOVERABLE) out.push(...(await s.tx.find<SellLot>(C.lots, { status, ...(f.productId ? { productId: f.productId } : {}) })));
    return out.filter((l) => Date.parse(l.expiresAt) > s.ms());
  }

  /** Public marketplace search: no seller identity or precise location, only verification badges. */
  async search(s: Scope, f: { productId?: string; originMarketId?: string; gradeGroup?: string } = {}) {
    const lots = (await this.discoverable(s, f)).filter((l) => (!f.originMarketId || l.originMarketId === f.originMarketId) && (!f.gradeGroup || l.gradeGroup === f.gradeGroup));
    const out = [];
    for (const l of lots.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.sellLotId.localeCompare(b.sellLotId))) {
      if ((await this.identity.user(s, l.sellerId))?.suspended) continue;
      const badges = (await this.identity.claimSummaries(s, l.sellerId)).map((c) => ({ type: c.type, displayLabelKey: c.displayLabelKey }));
      out.push({ ...publicLotView(l), verificationClaims: badges });
    }
    return out;
  }

  /** Suspension of a seller hides their unreserved lots. */
  async suspendSellerLots(s: Scope, sellerId: string) {
    for (const l of await s.tx.find<SellLot>(C.lots, { sellerId })) {
      if ((DISCOVERABLE as readonly string[]).includes(l.status) && toMilli(l.quantityReserved) === 0n) { l.status = "SUSPENDED"; this.touch(s, l); }
    }
  }

  /** Expiry tick: active lots past their expiry. */
  async expire(s: Scope) {
    let n = 0;
    for (const l of await s.tx.find<SellLot>(C.lots, { status: "ACTIVE" })) if (Date.parse(l.expiresAt) <= s.ms()) { l.status = "EXPIRED"; this.touch(s, l); n++; }
    return n;
  }

  location(l: SellLot) { return l.preciseLocation ?? (MARKETS[l.originMarketId] as { lat: number; lon: number }); }
}
