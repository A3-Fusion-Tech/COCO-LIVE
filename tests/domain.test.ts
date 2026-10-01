import test from "node:test";
import assert from "node:assert/strict";
import { aggregate, bucketKey, detectAnomalies, estimateTotalPaise, freshness, inr, transitionObservation, validateObservation, toMilli, addQuantity, subtractQuantity, observationWeight, type PriceObservation } from "../packages/domain/src/index.ts";
import { missingKeys, formatMoney, t, parseLocale } from "../packages/localization/src/index.ts";
import { redact } from "../packages/observability/src/index.ts";

const now = new Date("2026-10-01T06:00:00Z");
let n = 0;
const obs = (o: Partial<PriceObservation> = {}): PriceObservation => ({
  observationId: `o${++n}`, sourceClass: "VERIFIED_QUOTE", organizationId: `org${n}`, productId: "prod_mature_coconut", gradeGroup: "FAQ", marketId: "market_pollachi", unit: "NUT",
  stage: "FARM_GATE", tradeTerm: "EX_FARM", lowPaise: 2900, highPaise: 3200, referencePaise: 3050, observedAt: "2026-10-01T03:00:00Z", quantity: "1000", expiresAt: "2026-10-02T03:00:00Z", state: "ELIGIBLE", version: 1, supersedes: undefined, ...o,
});
const target = { productId: "prod_mature_coconut", marketId: "market_pollachi", unit: "NUT", stage: "FARM_GATE", tradeTerm: "EX_FARM", gradeGroup: "FAQ" } as const;

test("money is integer paise and quantities are exact decimals", () => {
  assert.throws(() => inr(10.5));
  assert.throws(() => inr(-1));
  assert.equal(estimateTotalPaise("2500", 3050), 7_625_000);
  assert.equal(estimateTotalPaise("0.5", 3), 2); // half-up
  assert.equal(addQuantity("0.1", "0.2"), "0.3");
  assert.equal(subtractQuantity("5", "1.25"), "3.75");
  assert.throws(() => subtractQuantity("1", "2"));
  assert.throws(() => toMilli("1.2345"));
  assert.throws(() => toMilli("-1"));
});

test("aggregate requires minimum evidence and independent organizations", () => {
  const two = [obs(), obs()];
  assert.equal(aggregate(two, target, now).kind, "INSUFFICIENT_EVIDENCE");
  const sameOrg = [obs({ organizationId: "x" }), obs({ organizationId: "x", observedAt: "2026-10-01T02:00:00Z" }), obs({ organizationId: "x", observedAt: "2026-10-01T01:00:00Z" })];
  assert.equal(aggregate(sameOrg, target, now).kind, "INSUFFICIENT_EVIDENCE", "duplicating one org must not raise diversity");
});

test("aggregate is order independent and reproducible", () => {
  const xs = [obs({ referencePaise: 3000 }), obs({ referencePaise: 3100 }), obs({ referencePaise: 3050 }), obs({ referencePaise: 3500, highPaise: 3600 }), obs({ referencePaise: 3040, sourceClass: "OFFICIAL_MARKET", expiresAt: undefined })];
  const a = aggregate(xs, target, now);
  const b = aggregate([...xs].reverse(), target, now);
  assert.equal(a.kind, "AGGREGATE");
  assert.deepEqual(a, b);
  if (a.kind === "AGGREGATE") {
    assert.equal(a.aggregate.referencePaise, 3050);
    assert.equal(a.aggregate.confidence, "HIGH");
    assert.equal(a.aggregate.calculationVersion, "weighted-median-v1");
  }
});

test("incompatible units, stages and products never aggregate; rejected never contributes", () => {
  const good = [obs(), obs(), obs()];
  const bad = [obs({ unit: "KG", referencePaise: 90000, lowPaise: 80000, highPaise: 99000 }), obs({ productId: "prod_milling_copra" }), obs({ stage: "RETAIL" }), obs({ state: "REJECTED", referencePaise: 1, lowPaise: 1, highPaise: 1 })];
  const r = aggregate([...good, ...bad], target, now);
  assert.equal(r.kind, "AGGREGATE");
  if (r.kind === "AGGREGATE") assert.equal(r.aggregate.evidenceSummary.observations, 3);
  assert.notEqual(bucketKey(obs({ unit: "KG" })), bucketKey(obs()));
});

test("older evidence never becomes fresher; stale is labelled", () => {
  assert.equal(freshness("2026-10-01T03:00:00Z", now), "CURRENT");
  assert.equal(freshness("2026-09-29T03:00:00Z", now), "AGING");
  assert.equal(freshness("2026-09-20T03:00:00Z", now), "STALE");
  const old = obs({ observedAt: "2026-09-20T03:00:00Z" });
  assert.ok(observationWeight(old, now, "market_pollachi") < observationWeight(obs(), now, "market_pollachi"));
  const ancient = [obs({ observedAt: "2026-09-01T00:00:00Z" }), obs({ observedAt: "2026-09-01T00:00:00Z" }), obs({ observedAt: "2026-09-01T00:00:00Z" })];
  assert.equal(aggregate(ancient, target, now).kind, "INSUFFICIENT_EVIDENCE");
});

test("expired executable quotes do not contribute", () => {
  const xs = [obs({ expiresAt: "2026-10-01T05:00:00Z" }), obs({ expiresAt: "2026-10-01T05:00:00Z" }), obs()];
  assert.equal(aggregate(xs, target, now).kind, "INSUFFICIENT_EVIDENCE");
});

test("validation catches schema and semantic errors", () => {
  const codes = (o: PriceObservation) => validateObservation(o, now).map((i) => i.code);
  assert.deepEqual(codes(obs()), []);
  assert.ok(codes(obs({ lowPaise: 4000, highPaise: 3000 })).includes("LOW_EXCEEDS_HIGH"));
  assert.ok(codes(obs({ productId: "prod_tender_coconut", unit: "KG" })).includes("UNIT_NOT_SUPPORTED"));
  assert.ok(codes(obs({ observedAt: "2026-10-05T00:00:00Z" })).includes("OBSERVED_IN_FUTURE"));
  assert.ok(codes(obs({ expiresAt: undefined })).includes("EXECUTABLE_QUOTE_NEEDS_EXPIRY_AND_QUANTITY"));
  assert.ok(codes(obs({ marketId: "market_nowhere" })).includes("UNKNOWN_MARKET"));
});

test("anomaly signals and observation state machine", () => {
  const o = obs({ referencePaise: 30500, lowPaise: 30000, highPaise: 31000 });
  const sig = detectAnomalies(o, { history: [3000, 3050, 3100, 3020], peers: [], ownRecentReferences: [] }).map((s) => s.code);
  assert.ok(sig.includes("HISTORICAL_JUMP") && sig.includes("POSSIBLE_UNIT_ERROR"));
  assert.deepEqual(detectAnomalies(obs(), { history: [3000, 3050, 3100], peers: [], ownRecentReferences: [] }), []);
  assert.equal(detectAnomalies(obs(), { history: [], peers: [], ownRecentReferences: [3050, 3050, 3050] })[0]?.code, "REPEATED_EXACT_VALUE");
  assert.throws(() => transitionObservation(obs({ state: "REJECTED" }), "ELIGIBLE"));
  assert.equal(transitionObservation(obs({ state: "PUBLISHED" }), "SUPERSEDED").state, "SUPERSEDED");
});

test("localization catalogs are complete and format Tamil/English", () => {
  assert.deepEqual(missingKeys().flatMap((m) => m.keys), []);
  assert.equal(parseLocale("ta-IN,en;q=0.8"), "ta");
  assert.equal(parseLocale("en", "ta"), "ta");
  assert.match(formatMoney(305000, "en"), /3,050/);
  assert.notEqual(t("ta", "price.not_offer"), t("en", "price.not_offer"));
  assert.equal(t("ta", "missing.key"), "missing.key");
});

test("log redaction hides sensitive fields", () => {
  assert.deepEqual(redact({ phone: "+91", nested: { otp: "123", ok: 1 } }), { phone: "[REDACTED]", nested: { otp: "[REDACTED]", ok: 1 } });
});
