import { createHash } from "node:crypto";
import {
  MARKETS, PRODUCTS, SOURCE_COMMODITY_MAP, SOURCE_MARKET_MAP, SOURCE_UNIT_MAP, aggregate, bucketKey, conflict, detectAnomalies, effectiveConfidence, forbidden,
  freshness, invalid, notFound, transitionObservation, validateObservation,
  type Aggregate, type AggregateResult, type MarketStage, type MspReference, type PriceObservation, type ProductId, type TradeTerm, type Unit,
} from "@livecoco/domain";
import { C } from "../../core/collections.ts";
import { uid } from "../../core/ids.ts";
import { orNotFound, type Scope } from "../../core/scope.ts";
import type { AuditLog, WorkQueue } from "../../core/audit.ts";
import type { IdentityService } from "../identity/identity.service.ts";
import type { IngestResult, PriceFilter, PriceHistory, RawRecord, SourceHealthRecord, SourceStatus } from "./prices.types.ts";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const HOUR = 3_600_000;
const LIVE_STATES = ["ELIGIBLE", "PUBLISHED"] as const;
const SOURCES = ["agmarknet", "contributors"];

const MSP: MspReference[] = [{ productId: "prod_milling_copra", unit: "QUINTAL", amountPaise: 1158200, seasonLabel: "2025 season (policy reference)", isMarketQuote: false }];

/** dd/mm/yyyy (AGMARKNET) or ISO: the observation date, never the retrieval time. 10:00 IST on that day. */
function sourceDate(v: string): string {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(v);
  if (m) return new Date(Date.UTC(+(m[3] as string), +(m[2] as string) - 1, +(m[1] as string), 4, 30)).toISOString();
  return /^\d{4}-\d{2}-\d{2}/.test(v) ? new Date(v).toISOString() : "";
}

const productRef = (id: ProductId) => ({ productId: id, name: PRODUCTS[id].name.en, nameTa: PRODUCTS[id].name.ta });
const marketRef = (id: string) => { const m = MARKETS[id]; return { marketId: id, name: m?.name.en ?? id, nameTa: m?.name.ta ?? id }; };
const rangeOf = (low: number, ref: number, high: number, unit: Unit) => {
  const m = (n: number) => ({ amountPaise: n, currency: "INR" });
  return { low: m(low), reference: m(ref), high: m(high), perUnit: unit };
};
const refOf = (x: PriceObservation) => x.referencePaise ?? Math.round((x.lowPaise + x.highPaise) / 2);
const matchesFilter = (o: { productId: string; marketId: string; stage: string; unit: string; gradeGroup: string }, f: PriceFilter) =>
  (!f.productId || o.productId === f.productId) && (!f.marketId || o.marketId === f.marketId || MARKETS[o.marketId]?.areaId === f.marketId) &&
  (!f.stage || o.stage === f.stage) && (!f.unit || o.unit === f.unit) && (!f.gradeGroup || o.gradeGroup === f.gradeGroup);
const inBucket = (key: string, productId: string, marketId: string, unit: string, stage: string) =>
  key.startsWith(`${productId}|`) && key.includes(`|${unit}|${stage}|`) && key.includes(`|${marketId}|`);

/**
 * Price intelligence: raw-first ingestion, normalisation and anomaly review, contributor quotes, corrections,
 * aggregation into published price buckets and the public price views.
 */
export class PricesService {
  private readonly identity: IdentityService;
  private readonly audit: AuditLog;
  private readonly queue: WorkQueue;

  constructor(identity: IdentityService, audit: AuditLog, queue: WorkQueue) {
    this.identity = identity;
    this.audit = audit;
    this.queue = queue;
  }

  // ---- source health -------------------------------------------------------------------------
  private async health(s: Scope, source: string): Promise<SourceHealthRecord> {
    return (await s.tx.get<SourceHealthRecord>(C.sourceHealth, source)) ?? { source, lastAttemptAt: undefined, lastSuccessAt: undefined, lastError: undefined, lastObservationAt: undefined, retrieved: 0, normalized: 0, unmapped: 0, rejected: 0, disabled: false, consecutiveFailures: 0 };
  }
  private saveHealth(s: Scope, h: SourceHealthRecord) { s.tx.put(C.sourceHealth, h.source, h); }

  async recordSourceFailure(s: Scope, source: string, error: string) {
    const h = await this.health(s, source);
    h.lastAttemptAt = s.iso();
    h.lastError = error.replace(/api-key=[^&\s]+/gi, "api-key=[REDACTED]");
    h.consecutiveFailures++;
    this.saveHealth(s, h);
  }

  private status(s: Scope, h: SourceHealthRecord): SourceStatus {
    if (h.disabled) return "DISABLED";
    if (h.consecutiveFailures >= 3) return "DEGRADED";
    const last = h.lastSuccessAt ? s.ms() - Date.parse(h.lastSuccessAt) : Infinity;
    if (last > 72 * HOUR) return "STALE";
    if (last > 26 * HOUR || h.consecutiveFailures > 0) return "DELAYED";
    return "HEALTHY";
  }
  async sourceStatus(s: Scope, source: string) { return this.status(s, await this.health(s, source)); }

  async listSourceHealth(s: Scope) {
    this.identity.require(s, "ops.source_health");
    const out = [];
    for (const src of SOURCES) { const h = await this.health(s, src); out.push({ ...h, status: this.status(s, h) }); }
    return out;
  }

  // ---- ingestion -----------------------------------------------------------------------------
  /** Idempotent: the raw payload is stored before parsing, and re-ingestion never refreshes observation time. */
  async ingestRaw(s: Scope, source: string, records: Record<string, unknown>[], parserVersion = "agmarknet-v1"): Promise<IngestResult> {
    const h = await this.health(s, source);
    h.lastAttemptAt = s.iso();
    let stored = 0, duplicates = 0, observations = 0, unmapped = 0;
    const seen = new Set<string>();
    for (const payload of records) {
      const hash = sha(JSON.stringify(payload, Object.keys(payload).sort()));
      if (seen.has(hash) || (await s.tx.find<RawRecord>(C.raw, { source, hash })).length) { duplicates++; continue; }
      seen.add(hash);
      const rec: RawRecord = { rawId: uid("raw"), source, hash, payload, receivedAt: s.iso(), parserVersion, parsed: false, unmapped: [] };
      stored++;
      h.retrieved++;
      if ((await this.normalizeAgmarknet(s, rec, h)) === "OBSERVATION") { observations++; h.normalized++; }
      else { unmapped++; h.unmapped++; }
      s.tx.put(C.raw, rec.rawId, rec); // raw records are immutable once written, so they are stored in their parsed state
    }
    h.lastSuccessAt = s.iso();
    h.lastError = undefined;
    h.consecutiveFailures = 0;
    this.saveHealth(s, h);
    return { stored, duplicates, observations, unmapped };
  }

  private async normalizeAgmarknet(s: Scope, rec: RawRecord, h: SourceHealthRecord): Promise<"OBSERVATION" | "UNMAPPED"> {
    const p = rec.payload;
    const str = (k: string) => String(p[k] ?? "").trim();
    const issues: string[] = [];
    const commodity = SOURCE_COMMODITY_MAP[str("commodity").toLowerCase()];
    const marketId = SOURCE_MARKET_MAP[str("market").toLowerCase()];
    const unit = SOURCE_UNIT_MAP[(str("price_unit") || "Rs./Quintal").toLowerCase()];
    if (!commodity) issues.push(`commodity:${str("commodity")}`);
    if (!marketId) issues.push(`market:${str("market")}`);
    if (!unit) issues.push(`unit:${str("price_unit")}`);
    const observedAt = sourceDate(str("arrival_date"));
    if (!observedAt) issues.push("date");
    const rupees = (k: string) => (/^\d+(\.\d+)?$/.test(str(k)) ? Math.round(Number(str(k)) * 100) : NaN);
    const low = rupees("min_price"), high = rupees("max_price"), modal = rupees("modal_price");
    if ([low, high, modal].some(Number.isNaN)) issues.push("price");
    rec.parsed = true;
    if (issues.length || !commodity || !marketId || !unit) {
      rec.unmapped = issues;
      this.queue.enqueue(s, { queue: "MAPPING", subject: rec.rawId, summary: `Unmapped source record: ${issues.join(", ")}`, reasons: issues, priority: 3, requiredCapability: "ops.price_review" });
      return "UNMAPPED";
    }
    await this.processObservation(s, {
      observationId: uid("obs"), sourceClass: "OFFICIAL_MARKET", organizationId: `src_${rec.source}`, productId: commodity, gradeGroup: str("grade") || "FAQ",
      marketId, unit, stage: "REGULATED_MARKET", tradeTerm: "AT_MARKET", lowPaise: low, highPaise: high, referencePaise: modal, observedAt,
      quantity: undefined, expiresAt: undefined, state: "RECEIVED", version: 1, supersedes: undefined,
    }, rec.rawId, h);
    return "OBSERVATION";
  }

  private observation(s: Scope, id: string) { return s.tx.get<PriceObservation>(C.observations, id); }
  private saveObs(s: Scope, o: PriceObservation) { return s.tx.put(C.observations, o.observationId, o); }

  /** Eligible or published observations, optionally restricted to one product/unit/stage. */
  private async liveObservations(s: Scope, match: Partial<PriceObservation> = {}) {
    const out: PriceObservation[] = [];
    for (const state of LIVE_STATES) out.push(...(await s.tx.find<PriceObservation>(C.observations, { ...match, state })));
    return out;
  }

  /** RECEIVED → NORMALIZED → (ELIGIBLE | NEEDS_REVIEW | REJECTED). */
  private async processObservation(s: Scope, o: PriceObservation, ref: string, h?: SourceHealthRecord): Promise<PriceObservation> {
    const issues = validateObservation(o, s.now());
    if (issues.length) {
      const health = h ?? (await this.health(s, o.sourceClass === "OFFICIAL_MARKET" ? "agmarknet" : "contributors"));
      health.rejected++;
      if (!h) this.saveHealth(s, health);
      this.audit.record(s, "system", "OBSERVATION_REJECTED", o.observationId, issues.map((i) => i.code).join(","), { ref });
      return this.saveObs(s, transitionObservation(o, "REJECTED"));
    }
    let cur = transitionObservation(o, "NORMALIZED");
    const sameBucket = (await this.liveObservations(s, { productId: o.productId, marketId: o.marketId, unit: o.unit })).filter((x) => x.observationId !== o.observationId && bucketKey(x) === bucketKey(o));
    const signals = detectAnomalies(o, {
      history: sameBucket.filter((x) => Date.parse(x.observedAt) < Date.parse(o.observedAt)).map(refOf),
      peers: sameBucket.filter((x) => x.organizationId !== o.organizationId && Math.abs(Date.parse(x.observedAt) - Date.parse(o.observedAt)) < 36 * HOUR).map(refOf),
      ownRecentReferences: sameBucket.filter((x) => x.organizationId === o.organizationId).map(refOf),
    });
    if (signals.length) {
      cur = transitionObservation(cur, "NEEDS_REVIEW");
      this.queue.enqueue(s, { queue: "PRICE_REVIEW", subject: o.observationId, summary: `Anomaly in ${o.productId} @ ${o.marketId}`, reasons: signals.map((x) => x.code), priority: signals.some((x) => x.code === "POSSIBLE_UNIT_ERROR") ? 1 : 2, requiredCapability: "ops.price_review" });
    } else cur = transitionObservation(cur, "ELIGIBLE");
    return this.saveObs(s, cur);
  }

  // ---- contributor quotes and operator review ------------------------------------------------
  async submitQuote(s: Scope, input: { productId: ProductId; marketId: string; gradeGroup: string; unit: Unit; stage: MarketStage; tradeTerm: TradeTerm; lowPaise: number; highPaise: number; referencePaise?: number; observedAt: string; quantity?: string; expiresAt?: string; organizationId: string }) {
    const user = s.user;
    if (!user.capabilities.includes("price.contribute")) throw forbidden("Not an approved price contributor");
    const scopes = await this.identity.approvedClaims(s, user.userId, "PRICE_CONTRIBUTOR_SCOPE");
    if (!scopes.length) throw forbidden("Contributor approval has been revoked");
    if (!scopes.some((c) => (c.scope.marketId ?? input.marketId) === input.marketId && (c.scope.productId ?? input.productId) === input.productId)) throw forbidden("Outside approved contributor scope");
    await this.identity.assertOrgMember(s, input.organizationId);
    const o: PriceObservation = {
      observationId: uid("obs"), sourceClass: "VERIFIED_QUOTE", organizationId: input.organizationId, productId: input.productId, gradeGroup: input.gradeGroup,
      marketId: input.marketId, unit: input.unit, stage: input.stage, tradeTerm: input.tradeTerm, lowPaise: input.lowPaise, highPaise: input.highPaise,
      referencePaise: input.referencePaise, observedAt: input.observedAt, quantity: input.quantity, expiresAt: input.expiresAt, state: "RECEIVED", version: 1, supersedes: undefined,
    };
    const issues = validateObservation(o, s.now());
    if (issues.length) throw invalid("OBSERVATION_INVALID", issues.map((i) => i.code).join(", "));
    const h = await this.health(s, "contributors");
    h.lastAttemptAt = s.iso(); h.lastSuccessAt = s.iso(); h.retrieved++; h.normalized++;
    this.saveHealth(s, h);
    const res = await this.processObservation(s, o, `quote:${user.userId}`);
    this.audit.record(s, user.userId, "QUOTE_SUBMITTED", o.observationId);
    return res;
  }

  /** Operators resolve anomaly reviews; contributors cannot approve their own. */
  async reviewObservation(s: Scope, observationId: string, decision: "APPROVE" | "REJECT", reason: string) {
    this.identity.require(s, "ops.price_review");
    if (!reason) throw invalid("REASON_REQUIRED", "A reason is required");
    const o = orNotFound(await this.observation(s, observationId), "Observation");
    if (o.state !== "NEEDS_REVIEW") throw conflict("INVALID_TRANSITION", `Observation is ${o.state}`);
    const next = this.saveObs(s, transitionObservation(o, decision === "APPROVE" ? "ELIGIBLE" : "REJECTED"));
    await this.queue.close(s, observationId);
    this.audit.record(s, s.user.userId, `OBSERVATION_${decision}D`, observationId, reason);
    return next;
  }

  async resolveMapping(s: Scope, queueItemId: string, mapping: { productId: ProductId; marketId: string; unit: Unit; stage?: MarketStage }, reason: string) {
    this.identity.require(s, "ops.price_review");
    if (!reason) throw invalid("REASON_REQUIRED", "A reason is required");
    const q = await this.queue.get(s, queueItemId);
    const rec = q && (await s.tx.get<RawRecord>(C.raw, q.subject));
    if (!q || !rec || q.queue !== "MAPPING") throw notFound("Mapping item");
    const p = rec.payload;
    const rupees = (k: string) => Math.round(Number(p[k]) * 100);
    if (!/^(\d{2})\/(\d{2})\/(\d{4})$/.test(String(p.arrival_date))) throw invalid("INVALID_DATE", "Source record has no parseable date");
    const o: PriceObservation = {
      observationId: uid("obs"), sourceClass: "OFFICIAL_MARKET", organizationId: `src_${rec.source}`, productId: mapping.productId, gradeGroup: String(p.grade ?? "FAQ"), marketId: mapping.marketId,
      unit: mapping.unit, stage: mapping.stage ?? "REGULATED_MARKET", tradeTerm: "AT_MARKET", lowPaise: rupees("min_price"), highPaise: rupees("max_price"), referencePaise: rupees("modal_price"),
      observedAt: sourceDate(String(p.arrival_date)), quantity: undefined, expiresAt: undefined, state: "RECEIVED", version: 1, supersedes: undefined,
    };
    await this.queue.close(s, rec.rawId);
    this.audit.record(s, s.user.userId, "MAPPING_RESOLVED", rec.rawId, reason);
    return this.processObservation(s, o, rec.rawId);
  }

  /** Corrections never mutate the raw record or the old observation's values: they supersede it. */
  async correctObservation(s: Scope, observationId: string, fix: { lowPaise: number; highPaise: number; referencePaise?: number }, reason: string) {
    const actor = s.user;
    const old = orNotFound(await this.observation(s, observationId), "Observation");
    const isOwner = old.sourceClass === "VERIFIED_QUOTE" && actor.organizationIds.includes(old.organizationId);
    if (!isOwner) this.identity.require(s, "ops.price_review");
    if (!reason) throw invalid("REASON_REQUIRED", "A correction reason is required");
    if (!(LIVE_STATES as readonly string[]).includes(old.state)) throw conflict("INVALID_TRANSITION", `Observation is ${old.state}`);
    const replacement: PriceObservation = { ...old, observationId: uid("obs"), ...fix, referencePaise: fix.referencePaise, state: "RECEIVED", version: old.version + 1, supersedes: old.observationId };
    this.saveObs(s, { ...old, state: old.state === "ELIGIBLE" ? "REJECTED" : "SUPERSEDED" });
    const res = await this.processObservation(s, replacement, `correction:${old.observationId}`);
    this.audit.record(s, actor.userId, "OBSERVATION_CORRECTED", old.observationId, reason, { replacement: res.observationId });
    return { replacement: res, republished: await this.refreshAggregates(s) };
  }

  // ---- aggregation ---------------------------------------------------------------------------
  /** Every bucket's aggregate history (oldest first). */
  private async aggregates(s: Scope) { return (await s.tx.find<PriceHistory>(C.aggregates)).map((h) => h.history); }

  /** Recomputes every bucket that has live observations; idempotent for unchanged inputs. */
  async refreshAggregates(s: Scope): Promise<number> {
    const obs = await this.liveObservations(s);
    const targets = new Map<string, Parameters<typeof aggregate>[1]>();
    for (const o of obs) {
      if (o.sourceClass === "MSP_REFERENCE") continue;
      const t = { productId: o.productId, marketId: o.marketId, unit: o.unit, stage: o.stage, tradeTerm: o.tradeTerm, gradeGroup: o.gradeGroup };
      targets.set(bucketKey(t), t);
    }
    const byId = new Map(obs.map((o) => [o.observationId, o]));
    let changed = 0;
    for (const [key, t] of targets) {
      const res = aggregate([...byId.values()], t, s.now());
      if (res.kind !== "AGGREGATE") continue;
      const hist = (await s.tx.get<PriceHistory>(C.aggregates, key))?.history ?? [];
      const prev = hist[hist.length - 1];
      const a = res.aggregate;
      const same = prev && prev.referencePaise === a.referencePaise && prev.lowPaise === a.lowPaise && prev.highPaise === a.highPaise && prev.contributingObservationIds.join() === a.contributingObservationIds.join();
      if (!same) { s.tx.put(C.aggregates, key, { bucket: key, history: [...hist, a] } satisfies PriceHistory); changed++; }
      for (const id of a.contributingObservationIds) {
        const o = byId.get(id);
        if (o?.state === "ELIGIBLE") { const pub = transitionObservation(o, "PUBLISHED"); byId.set(id, pub); this.saveObs(s, pub); }
      }
    }
    return changed;
  }

  /** Public view: aggregates where evidence rules hold, otherwise the latest official observation; stale data is labelled. */
  async latestPrices(s: Scope, filter: PriceFilter = {}) {
    const now = s.now();
    const obs = await this.liveObservations(s);
    const items: Record<string, unknown>[] = [];
    const seen = new Set<string>();
    for (const hist of await this.aggregates(s)) {
      const a = hist[hist.length - 1];
      if (!a) continue;
      seen.add(a.bucket);
      if (!matchesFilter(a, filter)) continue;
      const still = aggregate(obs, a, now);
      // A failing source or expiring evidence changes freshness and state; the last known value is kept but labelled.
      if (still.kind !== "AGGREGATE") items.push(this.renderAggregate(a, "STALE", "LOW"));
      else items.push(this.renderAggregate(still.aggregate, freshness(a.observedWindow.endsAt, now), effectiveConfidence(still.aggregate, now)));
    }
    const officials = new Map<string, PriceObservation>();
    for (const o of obs) {
      const k = bucketKey(o);
      if (o.sourceClass !== "OFFICIAL_MARKET" || seen.has(k)) continue;
      const cur = officials.get(k);
      if (!cur || Date.parse(o.observedAt) > Date.parse(cur.observedAt)) officials.set(k, o);
    }
    for (const o of officials.values()) {
      if (!matchesFilter(o, filter)) continue;
      items.push({
        priceAggregateId: null, kind: "OFFICIAL_OBSERVATION_ONLY", product: productRef(o.productId), market: marketRef(o.marketId), stage: o.stage, tradeTerm: o.tradeTerm, gradeGroup: o.gradeGroup,
        range: rangeOf(o.lowPaise, refOf(o), o.highPaise, o.unit), observedWindow: { startsAt: o.observedAt, endsAt: o.observedAt }, freshness: freshness(o.observedAt, now),
        confidence: "LOW", messageKey: "price.insufficient", evidenceSummary: { observations: 1, independentOrganizations: 1, officialMarketObservations: 1, verifiedQuotes: 0, completedTrades: 0 },
        calculationVersion: null, disclaimerKey: "price.not_offer",
      });
    }
    const id = (x: Record<string, unknown>, k: "product" | "market") => String((x[k] as Record<string, string>)[`${k}Id`]);
    return items.sort((a, b) => id(a, "product").localeCompare(id(b, "product")) || id(a, "market").localeCompare(id(b, "market")));
  }

  private renderAggregate(a: Aggregate, fresh: string, confidence: string) {
    return {
      priceAggregateId: `pa_${sha(a.bucket + a.calculatedAt).slice(0, 12)}`, kind: "AGGREGATE", product: productRef(a.productId), market: marketRef(a.marketId), stage: a.stage, tradeTerm: a.tradeTerm, gradeGroup: a.gradeGroup,
      range: rangeOf(a.lowPaise, a.referencePaise, a.highPaise, a.unit), observedWindow: a.observedWindow, freshness: fresh, confidence,
      messageKey: fresh === "STALE" ? "price.stale" : confidence === "LOW" ? "price.limited_evidence" : null,
      evidenceSummary: a.evidenceSummary, calculationVersion: a.calculationVersion, disclaimerKey: "price.not_offer",
    };
  }

  /** Summarised, contributor-anonymous evidence for one bucket. */
  async priceEvidence(s: Scope, productId: string, marketId: string, unit: string, stage: string) {
    const hist = (await this.aggregates(s)).find((h) => { const a = h[h.length - 1]; return !!a && inBucket(a.bucket, productId, marketId, unit, stage); });
    const a = hist?.[hist.length - 1];
    if (!a) throw notFound("Price");
    const observations = [];
    for (const id of a.contributingObservationIds) {
      const o = orNotFound(await this.observation(s, id), "Observation");
      observations.push({ sourceClass: o.sourceClass, observedAt: o.observedAt, range: rangeOf(o.lowPaise, o.referencePaise ?? o.lowPaise, o.highPaise, o.unit) }); // no contributor identity
    }
    return { bucket: a.bucket, calculationVersion: a.calculationVersion, calculatedAt: a.calculatedAt, evidenceSummary: a.evidenceSummary, observations };
  }

  async priceHistory(s: Scope, productId: string, marketId: string, unit: string, stage: string) {
    const out: Aggregate[] = [];
    for (const h of await this.aggregates(s)) { const last = h[h.length - 1]; if (last && inBucket(last.bucket, productId, marketId, unit, stage)) out.push(...h); }
    return out.sort((x, y) => x.calculatedAt.localeCompare(y.calculatedAt)).map((a) => ({ calculatedAt: a.calculatedAt, range: rangeOf(a.lowPaise, a.referencePaise, a.highPaise, a.unit), confidence: a.confidence, observedWindow: a.observedWindow, calculationVersion: a.calculationVersion }));
  }

  /** Reproduces a historical aggregate from its stored inputs (audit). */
  async reproduceAggregate(s: Scope, a: Aggregate): Promise<AggregateResult> {
    const inputs: PriceObservation[] = [];
    for (const id of a.contributingObservationIds) inputs.push(orNotFound(await this.observation(s, id), "Observation"));
    return aggregate(inputs, a, new Date(a.calculatedAt));
  }

  mspReferences() { return MSP.map((m) => ({ ...m, noteKey: "price.msp_note" })); }
}
