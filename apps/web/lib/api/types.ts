/**
 * The `/v1` resources the web UI reads, written by hand from the API controllers (`apps/api/src/http/controllers`)
 * and docs/api/resources.md. Only fields the UI uses or passes back are declared; the API may send more.
 */

export type ProductId = "prod_mature_coconut" | "prod_tender_coconut" | "prod_milling_copra" | "prod_ball_copra";
export type Unit = "NUT" | "KG" | "QUINTAL" | "TONNE";
export type Stage = "FARM_GATE" | "REGULATED_MARKET" | "WHOLESALE" | "PROCESSOR_PURCHASE" | "RETAIL";
export type TradeTerm = "EX_FARM" | "DELIVERED" | "AT_MARKET" | "EX_WAREHOUSE";
export type Localized = { en: string; ta: string };

export interface List<T> { items: T[] }
export interface Page<T> extends List<T> { page: { nextCursor: string | null; hasMore: boolean } }
export interface Money { amountPaise: number; currency: "INR" }

// ---- catalog and prices (public) --------------------------------------------
export interface Catalog {
  products: { productId: ProductId; name: Localized; units: Unit[]; stages: Stage[]; requiredAttributes: string[] }[];
  markets: { marketId: string; name: Localized; areaId: string }[];
}

export type Freshness = "CURRENT" | "AGING" | "STALE";
export type Confidence = "HIGH" | "MEDIUM" | "LOW";
export interface EvidenceSummary { observations: number; independentOrganizations: number; officialMarketObservations: number; verifiedQuotes: number; completedTrades: number }
export interface PriceRange { low: Money; reference: Money; high: Money; perUnit: Unit }
export interface PriceItem {
  priceAggregateId: string | null;
  kind: "AGGREGATE" | "OFFICIAL_OBSERVATION_ONLY";
  product: { productId: ProductId; name: string; nameTa: string };
  market: { marketId: string; name: string; nameTa: string };
  stage: Stage;
  tradeTerm: TradeTerm;
  gradeGroup: string;
  range: PriceRange;
  observedWindow: { startsAt: string; endsAt: string };
  freshness: Freshness;
  confidence: Confidence;
  messageKey?: string | null;
  evidenceSummary: EvidenceSummary;
  calculationVersion: string | null;
}
export interface LatestPrices extends List<PriceItem> { disclaimerKey: string }
export interface MspItem { productId: ProductId; unit: Unit; amountPaise: number; seasonLabel: string; noteKey?: string }
export interface PriceEvidence {
  bucket: string;
  calculationVersion: string;
  calculatedAt: string;
  evidenceSummary: EvidenceSummary;
  observations: { sourceClass: string; observedAt: string; range: PriceRange }[];
}

// ---- identity -----------------------------------------------------------------
export interface ClaimSummary { type: string; status: string; verifiedAt?: string | null; expiresAt?: string | null; displayLabelKey?: string }
export interface Me {
  userId: string;
  displayName: string;
  actingAs: "INDEPENDENT" | "ORGANIZATION";
  organizationIds: string[];
  capabilities: string[];
  locale: "en" | "ta";
  claims: ClaimSummary[];
}
export type OrganizationKind = "FARMER_GROUP" | "FPO" | "TRADER" | "PROCESSOR" | "BUYER" | "INSPECTION_PARTNER" | "LOGISTICS_PARTNER";
export interface OrganizationMembership { organizationId: string; name: string; kind: OrganizationKind; role?: string }
export interface VerifiedSession { token: string; user: { userId: string; capabilities: string[]; locale: string } }

// ---- marketplace --------------------------------------------------------------
export interface Fulfilment { mode: "PICKUP" | "DELIVERY"; costsIncluded: string[]; costsExcluded: string[] }
export type PriceExpectation = { unitPricePaise: number } | { inviteOffers: true };
interface LotBase {
  sellLotId: string;
  organizationId?: string;
  listedOnBehalfOf?: string;
  productId: ProductId;
  gradeAttributes: Record<string, string>;
  gradeGroup: string;
  unit: Unit;
  quantityTotal: string;
  quantityReserved: string;
  partialFulfilmentAllowed: boolean;
  originMarketId: string;
  availableFrom: string;
  availableTo: string;
  expiresAt: string;
  fulfilment: Fulfilment;
  priceExpectation: PriceExpectation;
  photoCount: number;
  status: string;
  version: number;
  createdAt: string;
}
/** `GET /v1/me/sell-lots`: the seller's own lots. */
export type SellLot = LotBase;
/** `GET /v1/sell-lots`: the public market view (no seller id or precise location). */
export interface MarketLot extends LotBase { quantityAvailable: string; verificationClaims: { type: string; displayLabelKey?: string }[] }
export interface MatchCandidate { sellLotId: string; requirementId: string; score: number; reasons: string[] }

export interface BuyRequirement {
  requirementId: string;
  productId: ProductId;
  gradeGroup: string;
  unit: Unit;
  targetQuantity: string;
  minQuantity: string;
  fulfilledQuantity: string;
  destination: { marketId: string };
  requiredFrom: string;
  requiredBy: string;
  expiresAt: string;
  status: string;
}

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
  sellLotId: string;
  createdByPartyId: string;
  sellerId: string;
  buyerId: string;
  terms: OfferTerms;
  estimatedTotalPaise: number;
  expiresAt: string;
  status: string;
}

export interface DealCard { revision: number; terms: OfferTerms; totalPaise: number; offerId: string; createdAt: string }
export interface DealEvent { seq: number; type: string; actorId: string; at: string }
export interface Deal {
  dealId: string;
  sellLotId: string;
  sellerId: string;
  buyerId: string;
  status: string;
  cards: DealCard[];
  events: DealEvent[];
  pendingAmendment?: { terms: OfferTerms; proposedBy: string };
  disputeId?: string;
}
export interface Dispute {
  disputeId: string;
  dealId: string;
  openedBy: string;
  respondent: string;
  reason: string;
  status: string;
  responseDueAt: string;
  response?: { text: string; at: string };
  resolution?: { outcome: string; reason: string; at: string };
}

export interface Alert {
  alertId: string;
  productId: ProductId;
  marketId: string;
  unit: Unit;
  stage: Stage;
  direction: "ABOVE" | "BELOW" | "BULLETIN";
  thresholdPaise?: number;
  channel: "SMS" | "WHATSAPP" | "PUSH";
  status: "ACTIVE" | "PAUSED" | "CANCELLED";
}

// ---- fulfilment, FPO and partners -------------------------------------------------
export interface Partner { partnerId: string; organizationId: string; kind: "INSPECTION" | "LOGISTICS"; serviceMarketIds: string[]; status: string }
export interface PartnerListing { partnerId: string; kind: "INSPECTION" | "LOGISTICS"; name?: string; serviceMarketIds: string[] }
export interface PartnerSla { inspections: Record<string, unknown>; transport: Record<string, unknown> }
export interface Inspection {
  inspectionId: string;
  dealId: string;
  partnerId: string;
  status: "REQUESTED" | "SCHEDULED" | "COMPLETED" | "DECIDED" | "CANCELLED";
  scheduledAt: string;
  location: string;
  result?: { outcome: "PASS" | "FAIL" | "CONDITIONAL"; measurements: Record<string, number>; note: string };
}
export interface TransportRequest {
  requestId: string;
  dealId: string;
  pickupMarketId: string;
  destinationMarketId: string;
  weightKg: number;
  windowFrom: string;
  windowTo: string;
  status: "OPEN" | "BOOKED" | "PICKED_UP" | "IN_TRANSIT" | "DELIVERED" | "CANCELLED";
}
export interface TransportQuote { quoteId: string; requestId: string; pricePaise: number; vehicleType: string; etaFrom: string; etaTo: string; validUntil: string; status: string }
export interface MemberLot {
  memberLotId: string;
  organizationId: string;
  memberName: string;
  productId: ProductId;
  unit: Unit;
  quantity: string;
  status: "PENDING_REVIEW" | "APPROVED" | "REJECTED" | "AGGREGATED" | "RELEASED";
}
export interface Settlement { settlementId: string; dealId: string; status: "DRAFT" | "APPROVED"; grossPaise: number; deductionTotalPaise: number; netPaise: number }
export interface UploadIntent { mediaId: string; uploadUrl: string }

// ---- operations -------------------------------------------------------------------
export type QueueName = "PRICE_REVIEW" | "MAPPING" | "VERIFICATION" | "LISTING_REVIEW" | "DISPUTE" | "RISK";
export interface QueueItem { queueItemId: string; queue: QueueName; subject: string; summary: string; reasons: string[]; priority: number; ageMinutes: number }
export interface SourceHealth { source: string; status: string; retrieved: number; unmapped: number; rejected: number; lastSuccessAt?: string }
export interface AuditEntry { seq: number; at: string; actorId: string; action: string; subject: string; reason?: string }
