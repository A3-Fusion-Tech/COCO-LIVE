import { MARKETS, PRODUCTS, type MarketStage, type ProductId, type TradeTerm, type Unit } from "./catalog.ts";
import { invalid } from "./errors.ts";

export type SourceClass = "OFFICIAL_MARKET" | "VERIFIED_QUOTE" | "COMPLETED_TRADE" | "MSP_REFERENCE";
export type ObservationState = "RECEIVED" | "NORMALIZED" | "ELIGIBLE" | "PUBLISHED" | "NEEDS_REVIEW" | "REJECTED" | "SUPERSEDED" | "WITHDRAWN";
export type Confidence = "HIGH" | "MEDIUM" | "LOW";

export interface PriceObservation {
  observationId: string;
  sourceClass: SourceClass;
  /** Organization (or official source) that reported; used for independence counting. */
  organizationId: string;
  productId: ProductId;
  gradeGroup: string;
  marketId: string;
  unit: Unit;
  stage: MarketStage;
  tradeTerm: TradeTerm;
  lowPaise: number;
  highPaise: number;
  /** Modal/reference value if the source provides one. */
  referencePaise: number | undefined;
  /** When the market observation happened — never the retrieval time. */
  observedAt: string;
  quantity: string | undefined;
  expiresAt: string | undefined;
  state: ObservationState;
  version: number;
  supersedes: string | undefined;
}

export const CALCULATION_VERSION = "weighted-median-v1";
export const FRESH_HOURS = 36;
export const STALE_HOURS = 72;
export const MAX_OBSERVATION_AGE_HOURS = 24 * 7;

const TRANSITIONS: Record<ObservationState, ObservationState[]> = {
  RECEIVED: ["NORMALIZED", "NEEDS_REVIEW", "REJECTED"],
  NORMALIZED: ["ELIGIBLE", "NEEDS_REVIEW", "REJECTED"],
  ELIGIBLE: ["PUBLISHED", "REJECTED"],
  NEEDS_REVIEW: ["ELIGIBLE", "REJECTED"],
  PUBLISHED: ["SUPERSEDED", "WITHDRAWN"],
  SUPERSEDED: [],
  WITHDRAWN: [],
  REJECTED: [],
};

export function transitionObservation(o: PriceObservation, to: ObservationState): PriceObservation {
  if (!TRANSITIONS[o.state].includes(to)) {
    throw invalid("INVALID_TRANSITION", `Observation cannot move ${o.state} → ${to}`);
  }
  return { ...o, state: to };
}

/** Observations are compatible only if every price dimension matches. */
export function bucketKey(o: Pick<PriceObservation, "productId" | "gradeGroup" | "unit" | "stage" | "tradeTerm" | "marketId">, areaLevel = false): string {
  const place = areaLevel ? (MARKETS[o.marketId]?.areaId ?? o.marketId) : o.marketId;
  return [o.productId, o.gradeGroup, o.unit, o.stage, o.tradeTerm, place, "INR"].join("|");
}

export interface ValidationIssue {
  code: string;
  field?: string;
}

/** Schema + semantic validation (stages 1 and 3). */
export function validateObservation(o: PriceObservation, now: Date): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const [f, v] of [["lowPaise", o.lowPaise], ["highPaise", o.highPaise]] as const) {
    if (!Number.isSafeInteger(v) || v < 0) issues.push({ code: "INVALID_MONEY", field: f });
  }
  if (o.lowPaise > o.highPaise) issues.push({ code: "LOW_EXCEEDS_HIGH", field: "lowPaise" });
  if (o.referencePaise !== undefined && (o.referencePaise < o.lowPaise || o.referencePaise > o.highPaise)) {
    issues.push({ code: "REFERENCE_OUT_OF_RANGE", field: "referencePaise" });
  }
  const t = Date.parse(o.observedAt);
  if (Number.isNaN(t)) issues.push({ code: "INVALID_OBSERVED_AT", field: "observedAt" });
  else if (t > now.getTime() + 5 * 60_000) issues.push({ code: "OBSERVED_IN_FUTURE", field: "observedAt" });
  const product = PRODUCTS[o.productId];
  if (!product?.enabled) issues.push({ code: "UNKNOWN_PRODUCT", field: "productId" });
  else {
    if (!product.units.includes(o.unit)) issues.push({ code: "UNIT_NOT_SUPPORTED", field: "unit" });
    if (!product.stages.includes(o.stage)) issues.push({ code: "STAGE_NOT_SUPPORTED", field: "stage" });
  }
  if (!MARKETS[o.marketId]) issues.push({ code: "UNKNOWN_MARKET", field: "marketId" });
  if (o.sourceClass === "VERIFIED_QUOTE" && (!o.expiresAt || !o.quantity)) {
    issues.push({ code: "EXECUTABLE_QUOTE_NEEDS_EXPIRY_AND_QUANTITY" });
  }
  return issues;
}

export interface AnomalyContext {
  /** Recent eligible/published reference values in the same bucket. */
  history: number[];
  /** Same-window reference values from other organizations. */
  peers: number[];
  /** Exact reference values recently submitted by the same organization. */
  ownRecentReferences: number[];
}

export interface AnomalySignal {
  code: "HISTORICAL_JUMP" | "PEER_DISTANCE" | "REPEATED_EXACT_VALUE" | "POSSIBLE_UNIT_ERROR";
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2;
};

export function detectAnomalies(o: PriceObservation, ctx: AnomalyContext): AnomalySignal[] {
  const signals: AnomalySignal[] = [];
  const ref = o.referencePaise ?? Math.round((o.lowPaise + o.highPaise) / 2);
  if (ctx.history.length >= 3) {
    const m = median(ctx.history);
    const mad = median(ctx.history.map((x) => Math.abs(x - m))) || m * 0.02;
    if (Math.abs(ref - m) > Math.max(5 * mad, m * 0.25)) signals.push({ code: "HISTORICAL_JUMP" });
    if (ref > m * 8 || ref < m / 8) signals.push({ code: "POSSIBLE_UNIT_ERROR" });
  }
  if (ctx.peers.length >= 2) {
    const m = median(ctx.peers);
    if (Math.abs(ref - m) > m * 0.4) signals.push({ code: "PEER_DISTANCE" });
  }
  if (ctx.ownRecentReferences.length >= 3 && ctx.ownRecentReferences.every((x) => x === ref)) {
    signals.push({ code: "REPEATED_EXACT_VALUE" });
  }
  return signals;
}

// ---- Aggregation ---------------------------------------------------------

const SOURCE_WEIGHT: Record<SourceClass, number> = { OFFICIAL_MARKET: 1.0, VERIFIED_QUOTE: 0.8, COMPLETED_TRADE: 1.2, MSP_REFERENCE: 0 };
const EXECUTION_WEIGHT: Record<SourceClass, number> = { OFFICIAL_MARKET: 1.0, VERIFIED_QUOTE: 1.1, COMPLETED_TRADE: 1.3, MSP_REFERENCE: 0 };

export const ageHours = (observedAt: string, now: Date) => (now.getTime() - Date.parse(observedAt)) / 3_600_000;

export function freshnessWeight(hours: number): number {
  if (hours <= 6) return 1;
  return Math.max(0.1, Math.exp(-(hours - 6) / 48));
}

export function observationWeight(o: PriceObservation, now: Date, bucketMarketId: string): number {
  const geography = o.marketId === bucketMarketId ? 1 : 0.6;
  const w = SOURCE_WEIGHT[o.sourceClass] * freshnessWeight(ageHours(o.observedAt, now)) * geography * EXECUTION_WEIGHT[o.sourceClass];
  return Math.min(Math.max(w, 0), 1.5); // bounded
}

export function weightedPercentile(values: { v: number; w: number }[], p: number): number {
  const s = [...values].sort((a, b) => a.v - b.v || a.w - b.w);
  const total = s.reduce((a, x) => a + x.w, 0);
  let acc = 0;
  for (const x of s) {
    acc += x.w;
    if (acc >= total * p - 1e-9) return x.v;
  }
  return (s[s.length - 1] as { v: number }).v;
}

export interface Aggregate {
  bucket: string;
  productId: ProductId;
  marketId: string;
  unit: Unit;
  stage: MarketStage;
  tradeTerm: TradeTerm;
  gradeGroup: string;
  lowPaise: number;
  referencePaise: number;
  highPaise: number;
  confidence: Confidence;
  observedWindow: { startsAt: string; endsAt: string };
  evidenceSummary: {
    observations: number;
    independentOrganizations: number;
    officialMarketObservations: number;
    verifiedQuotes: number;
    completedTrades: number;
  };
  contributingObservationIds: string[];
  calculationVersion: string;
  calculatedAt: string;
}

export interface MinimumEvidence {
  minObservations: number;
  minOrganizations: number;
}
export const DEFAULT_MINIMUM_EVIDENCE: MinimumEvidence = { minObservations: 3, minOrganizations: 2 };

export type AggregateResult =
  | { kind: "AGGREGATE"; aggregate: Aggregate }
  | { kind: "INSUFFICIENT_EVIDENCE"; bucket: string; latestOfficial: PriceObservation | undefined; reason: string };

/** Pure, order-independent aggregation of eligible observations for one market bucket. */
export function aggregate(
  observations: PriceObservation[],
  target: { productId: ProductId; marketId: string; unit: Unit; stage: MarketStage; tradeTerm: TradeTerm; gradeGroup: string },
  now: Date,
  rules: MinimumEvidence = DEFAULT_MINIMUM_EVIDENCE,
): AggregateResult {
  const key = bucketKey(target);
  const areaKey = bucketKey(target, true);
  const pool = observations.filter(
    (o) =>
      (o.state === "ELIGIBLE" || o.state === "PUBLISHED") &&
      o.sourceClass !== "MSP_REFERENCE" &&
      (bucketKey(o) === key || bucketKey(o, true) === areaKey) &&
      ageHours(o.observedAt, now) <= MAX_OBSERVATION_AGE_HOURS &&
      !(o.expiresAt && Date.parse(o.expiresAt) < now.getTime()),
  );
  const officials = pool.filter((o) => o.sourceClass === "OFFICIAL_MARKET").sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt));
  const latestOfficial = officials[0];

  // Collapse repeated observations from one organization: keep its latest observation only.
  const byOrg = new Map<string, PriceObservation>();
  for (const o of [...pool].sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt) || a.observationId.localeCompare(b.observationId))) {
    const k = `${o.organizationId}|${o.sourceClass}|${o.marketId}`;
    if (!byOrg.has(k)) byOrg.set(k, o);
  }
  const used = [...byOrg.values()].sort((a, b) => a.observationId.localeCompare(b.observationId));
  const orgs = new Set(used.map((o) => o.organizationId));
  if (used.length < rules.minObservations || orgs.size < rules.minOrganizations) {
    return { kind: "INSUFFICIENT_EVIDENCE", bucket: key, latestOfficial, reason: "MINIMUM_EVIDENCE_NOT_MET" };
  }

  const w = used.map((o) => ({ o, w: observationWeight(o, now, target.marketId) })).filter((x) => x.w > 0);
  const refs = w.map((x) => ({ v: x.o.referencePaise ?? Math.round((x.o.lowPaise + x.o.highPaise) / 2), w: x.w }));
  const reference = weightedPercentile(refs, 0.5);
  const low = weightedPercentile(w.map((x) => ({ v: x.o.lowPaise, w: x.w })), 0.1);
  const high = weightedPercentile(w.map((x) => ({ v: x.o.highPaise, w: x.w })), 0.9);
  const times = used.map((o) => Date.parse(o.observedAt));
  const exact = used.filter((o) => o.marketId === target.marketId && o.gradeGroup === target.gradeGroup).length / used.length;
  const count = (c: SourceClass) => used.filter((o) => o.sourceClass === c).length;
  const sourceClasses = new Set(used.map((o) => o.sourceClass));
  const newestAge = ageHours(new Date(Math.max(...times)).toISOString(), now);
  const dispersion = reference > 0 ? (high - low) / reference : 1;

  let confidence: Confidence = "LOW";
  if (used.length >= 5 && orgs.size >= 3 && newestAge <= FRESH_HOURS && dispersion <= 0.35 && exact >= 0.6) confidence = "HIGH";
  else if ((used.length >= 3 && orgs.size >= 2) || (count("OFFICIAL_MARKET") >= 1 && orgs.size >= 2)) {
    confidence = newestAge <= STALE_HOURS && dispersion <= 0.6 && exact >= 0.5 ? "MEDIUM" : "LOW";
  }
  if (sourceClasses.size === 1 && confidence === "HIGH") confidence = "MEDIUM";

  return {
    kind: "AGGREGATE",
    aggregate: {
      bucket: key,
      ...target,
      lowPaise: low,
      referencePaise: reference,
      highPaise: high,
      confidence,
      observedWindow: { startsAt: new Date(Math.min(...times)).toISOString(), endsAt: new Date(Math.max(...times)).toISOString() },
      evidenceSummary: {
        observations: used.length,
        independentOrganizations: orgs.size,
        officialMarketObservations: count("OFFICIAL_MARKET"),
        verifiedQuotes: count("VERIFIED_QUOTE"),
        completedTrades: count("COMPLETED_TRADE"),
      },
      contributingObservationIds: used.map((o) => o.observationId),
      calculationVersion: CALCULATION_VERSION,
      calculatedAt: now.toISOString(),
    },
  };
}

export type Freshness = "CURRENT" | "AGING" | "STALE";
export function freshness(observedAt: string, now: Date): Freshness {
  const h = ageHours(observedAt, now);
  return h <= FRESH_HOURS ? "CURRENT" : h <= STALE_HOURS ? "AGING" : "STALE";
}

/** Stale aggregates are never shown as current; confidence is capped. */
export function effectiveConfidence(a: Aggregate, now: Date): Confidence {
  const f = freshness(a.observedWindow.endsAt, now);
  if (f === "STALE") return "LOW";
  if (f === "AGING" && a.confidence === "HIGH") return "MEDIUM";
  return a.confidence;
}

export interface MspReference {
  productId: ProductId;
  unit: Unit;
  amountPaise: number;
  seasonLabel: string;
  isMarketQuote: false;
}
