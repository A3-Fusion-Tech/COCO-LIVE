import { PRODUCTS, haversineKm, type ProductId, type Unit } from "./catalog.ts";
import { conflict, invalid } from "./errors.ts";
import { compareQuantity, estimateTotalPaise, subtractQuantity, addQuantity, toMilli } from "./money.ts";

// ---- Sell lot ------------------------------------------------------------
export type LotStatus = "DRAFT" | "PENDING_REVIEW" | "ACTIVE" | "RESERVED" | "SOLD" | "EXPIRED" | "WITHDRAWN" | "SUSPENDED";

const LOT_TRANSITIONS: Record<LotStatus, LotStatus[]> = {
  DRAFT: ["PENDING_REVIEW", "ACTIVE", "WITHDRAWN"],
  PENDING_REVIEW: ["ACTIVE", "DRAFT", "WITHDRAWN", "SUSPENDED"],
  ACTIVE: ["RESERVED", "SOLD", "EXPIRED", "WITHDRAWN", "SUSPENDED"],
  RESERVED: ["ACTIVE", "SOLD", "SUSPENDED"],
  SOLD: [],
  EXPIRED: [],
  WITHDRAWN: [],
  SUSPENDED: ["ACTIVE", "WITHDRAWN"],
};
export function assertLotTransition(from: LotStatus, to: LotStatus) {
  if (!LOT_TRANSITIONS[from].includes(to)) throw conflict("INVALID_LOT_TRANSITION", `Lot cannot move ${from} → ${to}`);
}

export interface FulfilmentTerm {
  mode: "PICKUP" | "DELIVERY";
  costsIncluded: string[]; // HARVEST, DEHUSK, LOADING, TRANSPORT, COMMISSION, TAX
  costsExcluded: string[];
}

export interface SellLot {
  sellLotId: string;
  sellerId: string;
  organizationId: string | undefined;
  /** Agent must disclose they list for someone else. */
  listedOnBehalfOf: string | undefined;
  productId: ProductId;
  gradeAttributes: Record<string, string>;
  gradeGroup: string;
  unit: Unit;
  quantityTotal: string;
  quantityReserved: string;
  partialFulfilmentAllowed: boolean;
  originMarketId: string;
  /** Precise location is private; public views never include it. */
  preciseLocation: { lat: number; lon: number } | undefined;
  availableFrom: string;
  availableTo: string;
  expiresAt: string;
  fulfilment: FulfilmentTerm;
  priceExpectation: { unitPricePaise: number } | { inviteOffers: true };
  photoCount: number;
  photoExceptionReason: string | undefined;
  status: LotStatus;
  version: number;
  createdAt: string;
}

export const availableQuantity = (l: SellLot) => subtractQuantity(l.quantityTotal, l.quantityReserved);

export function validateLotForActivation(l: SellLot, now: Date): string[] {
  const issues: string[] = [];
  const p = PRODUCTS[l.productId];
  if (!p?.enabled) return ["UNKNOWN_PRODUCT"];
  if (!p.units.includes(l.unit)) issues.push("UNIT_NOT_SUPPORTED");
  for (const attr of p.requiredAttributes) if (!l.gradeAttributes[attr]) issues.push(`MISSING_ATTRIBUTE_${attr.toUpperCase()}`);
  try {
    if (toMilli(l.quantityTotal) <= 0n) issues.push("QUANTITY_NOT_POSITIVE");
  } catch {
    issues.push("INVALID_QUANTITY");
  }
  if (Date.parse(l.availableFrom) > Date.parse(l.availableTo)) issues.push("WINDOW_INVALID");
  if (Date.parse(l.expiresAt) <= now.getTime()) issues.push("EXPIRY_IN_PAST");
  if (l.fulfilment.costsIncluded.length + l.fulfilment.costsExcluded.length === 0) issues.push("COSTS_NOT_STATED");
  if (l.photoCount < 1 && !l.photoExceptionReason) issues.push("PHOTO_REQUIRED");
  if (l.listedOnBehalfOf === "") issues.push("AGENT_DISCLOSURE_REQUIRED");
  return issues;
}

/** Fields whose change after offers exist is a material revision that invalidates offers. */
export const MATERIAL_LOT_FIELDS = ["productId", "gradeAttributes", "unit", "quantityTotal", "originMarketId", "fulfilment", "priceExpectation", "availableFrom", "availableTo"] as const;
export const isMaterialLotChange = (patch: Partial<SellLot>) => MATERIAL_LOT_FIELDS.some((f) => f in patch);

/** Public/search view omits precise location and internal fields. */
export function publicLotView(l: SellLot) {
  const { preciseLocation: _p, sellerId: _s, photoExceptionReason: _r, ...rest } = l;
  return { ...rest, quantityAvailable: availableQuantity(l) };
}

// ---- Buy requirement -----------------------------------------------------
export type RequirementStatus = "DRAFT" | "ACTIVE" | "FILLED" | "EXPIRED" | "CLOSED" | "SUSPENDED";
export type Cadence = "WEEKLY" | "FORTNIGHTLY" | "MONTHLY";

export interface BuyRequirement {
  requirementId: string;
  buyerId: string;
  organizationId: string | undefined;
  productId: ProductId;
  gradeAttributes: Record<string, string>;
  gradeGroup: string;
  unit: Unit;
  targetQuantity: string;
  minQuantity: string;
  partialAllowed: boolean;
  fulfilledQuantity: string;
  destination: { marketId: string; lat: number; lon: number };
  maxRadiusKm: number;
  requiredFrom: string;
  requiredBy: string;
  expiresAt: string;
  maxUnitPricePaise: number | undefined;
  requiredClaims: string[];
  recurrenceTemplateId: string | undefined;
  status: RequirementStatus;
  version: number;
}

export function validateRequirement(r: BuyRequirement, now: Date): string[] {
  const issues: string[] = [];
  const p = PRODUCTS[r.productId];
  if (!p?.enabled) return ["UNKNOWN_PRODUCT"];
  if (!p.units.includes(r.unit)) issues.push("UNIT_NOT_SUPPORTED");
  if (compareQuantity(r.minQuantity, r.targetQuantity) > 0) issues.push("MIN_EXCEEDS_TARGET");
  if (toMilli(r.targetQuantity) <= 0n) issues.push("QUANTITY_NOT_POSITIVE");
  if (Date.parse(r.requiredFrom) > Date.parse(r.requiredBy)) issues.push("WINDOW_INVALID");
  if (Date.parse(r.expiresAt) <= now.getTime()) issues.push("EXPIRY_IN_PAST");
  if (r.maxRadiusKm <= 0) issues.push("RADIUS_INVALID");
  return issues;
}

export interface RecurrenceTemplate {
  templateId: string;
  cadence: Cadence;
  occurrences: number;
  base: Omit<BuyRequirement, "requirementId" | "status" | "version" | "fulfilledQuantity" | "recurrenceTemplateId">;
}

const CADENCE_DAYS: Record<Cadence, number> = { WEEKLY: 7, FORTNIGHTLY: 14, MONTHLY: 30 };

/** Produces dated executable instances; editing a template only affects instances generated afterwards. */
export function instantiateRecurrence(t: RecurrenceTemplate, idFor: (i: number) => string): BuyRequirement[] {
  const day = 86_400_000;
  return Array.from({ length: t.occurrences }, (_, i) => {
    const shift = i * CADENCE_DAYS[t.cadence] * day;
    const iso = (s: string) => new Date(Date.parse(s) + shift).toISOString();
    return {
      ...t.base,
      requirementId: idFor(i),
      requiredFrom: iso(t.base.requiredFrom),
      requiredBy: iso(t.base.requiredBy),
      expiresAt: iso(t.base.expiresAt),
      fulfilledQuantity: "0",
      recurrenceTemplateId: t.templateId,
      status: i === 0 ? "ACTIVE" : "DRAFT",
      version: 1,
    };
  });
}

// ---- Matching ------------------------------------------------------------
export interface ParticipantState {
  active: boolean;
  blocked: string[];
  claims: string[]; // approved verification claim types
  completedDeals: number;
  suspended: boolean;
}

export interface MatchCandidate {
  sellLotId: string;
  requirementId: string;
  score: number;
  reasons: string[];
  incompatibilities: string[];
  eligible: boolean;
}

/** Deterministic, explainable. Matching never commits a trade. */
export function matchLotToRequirement(
  lot: SellLot,
  req: BuyRequirement,
  seller: ParticipantState,
  buyer: ParticipantState,
  lotLocation: { lat: number; lon: number },
  now: Date,
  hasPriorRelationship = false,
): MatchCandidate {
  const bad: string[] = [];
  const why: string[] = [];
  if (lot.productId !== req.productId) bad.push("PRODUCT_MISMATCH");
  else why.push("PRODUCT_EXACT");
  if (lot.unit !== req.unit) bad.push("UNIT_MISMATCH");
  if (lot.gradeGroup !== req.gradeGroup) bad.push("GRADE_INCOMPATIBLE");
  else why.push("GRADE_EXACT");
  if (lot.status !== "ACTIVE" && lot.status !== "RESERVED") bad.push("LOT_NOT_ACTIVE");
  if (req.status !== "ACTIVE") bad.push("REQUIREMENT_NOT_ACTIVE");
  if (Date.parse(lot.expiresAt) <= now.getTime()) bad.push("LOT_EXPIRED");
  if (Date.parse(req.expiresAt) <= now.getTime()) bad.push("REQUIREMENT_EXPIRED");
  if (!seller.active || seller.suspended) bad.push("SELLER_INACTIVE");
  if (!buyer.active || buyer.suspended) bad.push("BUYER_INACTIVE");
  if (seller.blocked.includes(req.buyerId) || buyer.blocked.includes(lot.sellerId)) bad.push("BLOCKED");
  for (const c of req.requiredClaims) if (!seller.claims.includes(c)) bad.push(`MISSING_CLAIM_${c}`);

  let coverage = 0;
  if (lot.unit === req.unit) {
    const avail = Number(toMilli(availableQuantity(lot)));
    const target = Number(toMilli(req.targetQuantity));
    const min = Number(toMilli(req.minQuantity));
    coverage = target ? Math.min(avail / target, 1) : 0;
    if (avail < min) bad.push("QUANTITY_BELOW_MINIMUM");
    else if (avail < target && !(lot.partialFulfilmentAllowed || req.partialAllowed)) bad.push("PARTIAL_NOT_ALLOWED");
    else why.push(`QUANTITY_COVERS_${Math.round(coverage * 100)}_PERCENT`);
  }

  const km = haversineKm(lotLocation, req.destination);
  if (km > req.maxRadiusKm) bad.push("OUTSIDE_RADIUS");
  else why.push(`PICKUP_WITHIN_${Math.ceil(km)}_KM`);

  const windowOverlap = Date.parse(lot.availableFrom) <= Date.parse(req.requiredBy) && Date.parse(lot.availableTo) >= Date.parse(req.requiredFrom);
  if (!windowOverlap) bad.push("WINDOW_NO_OVERLAP");
  else why.push("AVAILABILITY_OVERLAPS_REQUIRED_WINDOW");

  let priceOverlap = 0;
  if (req.maxUnitPricePaise !== undefined && "unitPricePaise" in lot.priceExpectation) {
    if (lot.priceExpectation.unitPricePaise <= req.maxUnitPricePaise) {
      priceOverlap = 1;
      why.push("PRICE_OVERLAP");
    } else bad.push("PRICE_NO_OVERLAP");
  }
  if (seller.claims.includes("PERSON_IDENTITY") && seller.claims.includes("ORGANIZATION_EXISTENCE")) why.push("IDENTITY_AND_ORG_VERIFIED");
  if (hasPriorRelationship) why.push("EXISTING_TRADING_RELATIONSHIP");

  const score =
    (lot.gradeGroup === req.gradeGroup ? 30 : 0) +
    coverage * 25 +
    Math.max(0, 1 - km / Math.max(req.maxRadiusKm, 1)) * 20 +
    priceOverlap * 10 +
    Math.min(seller.completedDeals, 10) +
    (hasPriorRelationship ? 5 : 0);
  return { sellLotId: lot.sellLotId, requirementId: req.requirementId, score: Math.round(score * 100) / 100, reasons: why, incompatibilities: bad, eligible: bad.length === 0 };
}

export const rankMatches = (cs: MatchCandidate[]) =>
  cs.filter((c) => c.eligible).sort((a, b) => b.score - a.score || a.sellLotId.localeCompare(b.sellLotId) || a.requirementId.localeCompare(b.requirementId));

// ---- Offers --------------------------------------------------------------
export type OfferStatus = "ACTIVE" | "ACCEPTED" | "REJECTED" | "COUNTERED" | "EXPIRED" | "WITHDRAWN" | "INVALIDATED";

export interface OfferTerms {
  quantity: string;
  unit: Unit;
  unitPricePaise: number;
  gradeGroup: string;
  fulfilmentMode: "PICKUP" | "DELIVERY";
  costsIncluded: string[];
  costsExcluded: string[];
  weighmentMethod: "COUNT" | "WEIGHBRIDGE" | "SCALE";
  weighmentLocation: string;
  paymentMethod: "CASH" | "UPI" | "BANK_TRANSFER";
  paymentDue: "ON_DELIVERY" | "ON_LOADING" | "WITHIN_3_DAYS" | "WITHIN_7_DAYS";
  fulfilmentFrom: string;
  fulfilmentBy: string;
  acceptanceWindowHours: number;
  inspectionTerms: string;
}

export interface Offer {
  offerId: string;
  threadId: string;
  revision: number;
  previousOfferId: string | undefined;
  sellLotId: string;
  requirementId: string | undefined;
  createdByPartyId: string;
  sellerId: string;
  buyerId: string;
  terms: OfferTerms;
  estimatedTotalPaise: number;
  expiresAt: string;
  status: OfferStatus;
  version: number;
  createdAt: string;
}

export const MAX_OFFER_TTL_HOURS = 72;

export function validateOfferTerms(t: OfferTerms, lot: SellLot, expiresAt: string, now: Date): string[] {
  const issues: string[] = [];
  if (t.unit !== lot.unit) issues.push("UNIT_MISMATCH");
  if (t.gradeGroup !== lot.gradeGroup) issues.push("GRADE_MISMATCH");
  try {
    if (toMilli(t.quantity) <= 0n) issues.push("QUANTITY_NOT_POSITIVE");
    else if (compareQuantity(t.quantity, availableQuantity(lot)) > 0) issues.push("QUANTITY_EXCEEDS_AVAILABLE");
    else if (compareQuantity(t.quantity, availableQuantity(lot)) < 0 && !lot.partialFulfilmentAllowed) issues.push("PARTIAL_NOT_ALLOWED");
  } catch {
    issues.push("INVALID_QUANTITY");
  }
  if (!Number.isSafeInteger(t.unitPricePaise) || t.unitPricePaise <= 0) issues.push("INVALID_PRICE");
  const exp = Date.parse(expiresAt);
  if (Number.isNaN(exp) || exp <= now.getTime()) issues.push("EXPIRY_IN_PAST");
  else if (exp - now.getTime() > MAX_OFFER_TTL_HOURS * 3_600_000) issues.push("EXPIRY_TOO_LONG");
  if (t.costsIncluded.length + t.costsExcluded.length === 0) issues.push("COSTS_NOT_STATED");
  if (Date.parse(t.fulfilmentFrom) > Date.parse(t.fulfilmentBy)) issues.push("WINDOW_INVALID");
  if (t.acceptanceWindowHours <= 0) issues.push("ACCEPTANCE_WINDOW_INVALID");
  return issues;
}

export const totalForTerms = (t: OfferTerms) => estimateTotalPaise(t.quantity, t.unitPricePaise);

export function assertOfferAcceptable(o: Offer, now: Date) {
  if (o.status === "EXPIRED" || (o.status === "ACTIVE" && Date.parse(o.expiresAt) <= now.getTime())) throw conflict("OFFER_EXPIRED", "The offer expired before it could be accepted.");
  if (o.status === "COUNTERED") throw conflict("OFFER_SUPERSEDED", "The offer has been countered.");
  if (o.status !== "ACTIVE") throw conflict("OFFER_NOT_ACTIVE", `Offer is ${o.status}`);
}

// ---- Deals ---------------------------------------------------------------
export type DealStatus = "AGREED" | "INSPECTION_PENDING" | "PICKUP_CONFIRMED" | "DELIVERED" | "ACCEPTED" | "DISPUTED" | "PAYMENT_CONFIRMED" | "COMPLETED" | "CANCELLED";
export type DealEventType =
  | "DEAL_CREATED" | "AMENDMENT_PROPOSED" | "AMENDMENT_ACCEPTED" | "AMENDMENT_REJECTED" | "PICKUP_CONFIRMED" | "DELIVERED"
  | "INSPECTION_REQUESTED" | "INSPECTION_COMPLETED" | "INSPECTION_ACCEPTED" | "INSPECTION_REJECTED" | "TRANSPORT_BOOKED" | "TRANSPORT_STATUS" | "SETTLEMENT_APPROVED"
  | "BUYER_ACCEPTED" | "DEEMED_ACCEPTED" | "DISPUTE_OPENED" | "DISPUTE_RESOLVED" | "PAYMENT_CONFIRMED" | "COMPLETED" | "CANCELLED" | "EVIDENCE_ADDED";

const DEAL_TRANSITIONS: Record<DealStatus, DealStatus[]> = {
  AGREED: ["INSPECTION_PENDING", "PICKUP_CONFIRMED", "DELIVERED", "CANCELLED", "DISPUTED"],
  INSPECTION_PENDING: ["AGREED", "CANCELLED", "DISPUTED"],
  PICKUP_CONFIRMED: ["DELIVERED", "CANCELLED", "DISPUTED"],
  DELIVERED: ["ACCEPTED", "DISPUTED"],
  ACCEPTED: ["PAYMENT_CONFIRMED", "DISPUTED"],
  DISPUTED: ["ACCEPTED", "PAYMENT_CONFIRMED", "CANCELLED", "COMPLETED"],
  PAYMENT_CONFIRMED: ["COMPLETED", "DISPUTED"],
  COMPLETED: [],
  CANCELLED: [],
};
export function assertDealTransition(from: DealStatus, to: DealStatus) {
  if (!DEAL_TRANSITIONS[from].includes(to)) throw conflict("INVALID_DEAL_TRANSITION", `Deal cannot move ${from} → ${to}`);
}

export interface DealCardRevision {
  revision: number;
  terms: OfferTerms;
  totalPaise: number;
  offerId: string;
  lotSnapshot: { productId: ProductId; gradeAttributes: Record<string, string>; originMarketId: string };
  createdAt: string;
  acceptedBy: string[];
  /** Deemed acceptance only applies if the card clearly says so. */
  deemedAcceptanceAgreed: boolean;
}

export interface DealEvent {
  seq: number;
  type: DealEventType;
  actorId: string;
  at: string;
  data?: Record<string, unknown>;
}

export interface Deal {
  dealId: string;
  sellLotId: string;
  requirementId: string | undefined;
  sellerId: string;
  buyerId: string;
  status: DealStatus;
  cards: DealCardRevision[];
  events: DealEvent[];
  pendingAmendment: { terms: OfferTerms; proposedBy: string } | undefined;
  deliveredAt: string | undefined;
  disputeId: string | undefined;
  version: number;
}

export const currentCard = (d: Deal) => d.cards[d.cards.length - 1] as DealCardRevision;

export const MATERIAL_TERM_FIELDS: (keyof OfferTerms)[] = ["quantity", "unitPricePaise", "unit", "gradeGroup", "fulfilmentMode", "paymentMethod", "paymentDue", "weighmentMethod", "costsIncluded", "costsExcluded"];

// ---- Disputes ------------------------------------------------------------
export type DisputeReason = "QUANTITY_VARIANCE" | "QUALITY_MISMATCH" | "DAMAGE" | "DELIVERY_FAILURE" | "UNDISCLOSED_DEDUCTION" | "NON_PAYMENT" | "NO_SHOW";
export type DisputeStatus = "OPEN" | "AWAITING_RESPONSE" | "UNDER_REVIEW" | "RESOLVED";
export type DisputeOutcome = "UPHELD" | "PARTIALLY_UPHELD" | "REJECTED" | "WITHDRAWN" | "SETTLED";

export interface Dispute {
  disputeId: string;
  dealId: string;
  openedBy: string;
  respondent: string;
  reason: DisputeReason;
  claimedQuantity: string | undefined;
  claimedAmountPaise: number | undefined;
  evidenceIds: string[];
  status: DisputeStatus;
  responseDueAt: string;
  response: { text: string; at: string; evidenceIds: string[] } | undefined;
  resolution: { outcome: DisputeOutcome; reason: string; operatorId: string; at: string } | undefined;
  openedAt: string;
}

export const DISPUTE_RESPONSE_HOURS = 48;

// ---- Reputation ----------------------------------------------------------
export interface ReputationEvent {
  partyId: string;
  type: "DEAL_COMPLETED" | "ON_TIME" | "LATE" | "QUANTITY_ACCEPTED_FULL" | "CANCELLED_BY_PARTY" | "DISPUTE_OPENED" | "DISPUTE_UPHELD_AGAINST" | "PAYMENT_ON_TIME" | "PAYMENT_LATE";
  dealId: string;
  at: string;
}

export const MIN_REPUTATION_SAMPLE = 5;

export function reputationSummary(events: ReputationEvent[], partyId: string) {
  const mine = events.filter((e) => e.partyId === partyId);
  const completed = mine.filter((e) => e.type === "DEAL_COMPLETED").length;
  if (completed < MIN_REPUTATION_SAMPLE) return { partyId, sufficientData: false as const, completedDeals: undefined };
  const c = (t: ReputationEvent["type"]) => mine.filter((e) => e.type === t).length;
  const rate = (n: number, d: number) => (d ? Math.round((n / d) * 100) : null);
  return {
    partyId,
    sufficientData: true as const,
    completedDeals: completed,
    onTimeRatePercent: rate(c("ON_TIME"), c("ON_TIME") + c("LATE")),
    fullQuantityRatePercent: rate(c("QUANTITY_ACCEPTED_FULL"), completed),
    cancellationCount: c("CANCELLED_BY_PARTY"),
    disputesUpheldAgainst: c("DISPUTE_UPHELD_AGAINST"),
    paymentOnTimeRatePercent: rate(c("PAYMENT_ON_TIME"), c("PAYMENT_ON_TIME") + c("PAYMENT_LATE")),
  };
}

export { addQuantity, subtractQuantity, compareQuantity, invalid };
