import test from "node:test";
import assert from "node:assert/strict";
import { makeWorld } from "../packages/test-support/src/index.ts";

const rec = (over: Record<string, unknown> = {}) => ({ state: "Tamil Nadu", district: "Coimbatore", market: "Pollachi", commodity: "Coconut", variety: "Other", grade: "FAQ", arrival_date: "01/10/2026", min_price: "2900", max_price: "3200", modal_price: "3050", price_unit: "Rs./Quintal", ...over });

function contributor(w: ReturnType<typeof makeWorld>, phone: string, orgName: string) {
  const a = w.login(phone);
  const org = w.p.createOrganization(a.user, orgName, "TRADER");
  w.verify(a.user, "PRICE_CONTRIBUTOR_SCOPE", { marketId: "market_pollachi", productId: "prod_mature_coconut" });
  return { ...a, org };
}
const quote = (orgId: string, ref: number, over: Record<string, unknown> = {}) => ({
  productId: "prod_mature_coconut" as const, marketId: "market_pollachi", gradeGroup: "FAQ", unit: "NUT" as const, stage: "FARM_GATE" as const, tradeTerm: "EX_FARM" as const,
  lowPaise: ref - 100, highPaise: ref + 100, referencePaise: ref, observedAt: "2026-10-01T04:00:00Z", quantity: "2000", expiresAt: "2026-10-02T04:00:00Z", organizationId: orgId, ...over,
});

test("official record: raw stored first, source date kept, replay is idempotent, unit semantics preserved", () => {
  const w = makeWorld();
  const r1 = w.p.ingestRaw("agmarknet", [rec()]);
  assert.equal(r1.observations, 1);
  const r2 = w.p.ingestRaw("agmarknet", [rec()]);
  assert.deepEqual([r2.stored, r2.duplicates], [0, 1]);
  const o = [...w.p.observations.values()][0]!;
  assert.equal(o.unit, "QUINTAL");
  assert.equal(o.observedAt, "2026-10-01T04:30:00.000Z");
  assert.equal(o.lowPaise, 290000);
  // A record arriving today with an older market date stays old
  w.clock.advanceHours(24 * 10);
  w.p.ingestRaw("agmarknet", [rec({ arrival_date: "01/10/2026", modal_price: "3051" })]);
  const latest = [...w.p.observations.values()].at(-1)!;
  assert.equal(latest.observedAt, "2026-10-01T04:30:00.000Z");
});

test("unmapped source values go to a review queue and are never guessed", () => {
  const w = makeWorld();
  const r = w.p.ingestRaw("agmarknet", [rec({ commodity: "Mystery Fruit" }), rec({ market: "Narnia" }), rec({ price_unit: "Rs./Bag" }), rec({ min_price: "abc" })]);
  assert.equal(r.unmapped, 4);
  assert.equal(w.p.observations.size, 0);
  const ops = w.operator();
  const q = w.p.listQueue(ops.user, ops.session, "MAPPING");
  assert.equal(q.length, 4);
  // operator resolves one explicitly
  const done = w.p.resolveMapping(ops.user, ops.session, q[0]!.queueItemId, { productId: "prod_mature_coconut", marketId: "market_pollachi", unit: "QUINTAL" }, "Confirmed with source");
  assert.equal(done.state, "ELIGIBLE");
  assert.throws(() => w.p.resolveMapping(ops.user, ops.session, q[1]!.queueItemId, { productId: "prod_mature_coconut", marketId: "market_pollachi", unit: "QUINTAL" }, ""), /reason/i);
});

test("end-to-end: contributors + official data aggregate, evidence is anonymous, thin evidence falls back", () => {
  const w = makeWorld();
  const cs = ["9111111111", "9222222222", "9333333333"].map((ph, i) => contributor(w, ph, `Trader ${i}`));
  w.p.ingestRaw("agmarknet", [rec({ commodity: "Coconut", price_unit: "Rs./Quintal" })]);
  // Official record is per quintal so it must not join the per-nut bucket
  assert.equal(w.p.refreshAggregates(), 0);
  const thin = w.p.latestPrices({ productId: "prod_mature_coconut", unit: "QUINTAL" });
  assert.equal(thin[0]!.kind, "OFFICIAL_OBSERVATION_ONLY");
  assert.equal(thin[0]!.messageKey, "price.insufficient");

  w.p.submitQuote(cs[0]!.user, quote(cs[0]!.org.organizationId, 3000));
  w.p.submitQuote(cs[1]!.user, quote(cs[1]!.org.organizationId, 3050));
  assert.equal(w.p.refreshAggregates(), 0, "two sources are below the minimum");
  assert.equal(w.p.latestPrices({ unit: "NUT" }).length, 0);
  w.p.submitQuote(cs[2]!.user, quote(cs[2]!.org.organizationId, 3100));
  assert.equal(w.p.refreshAggregates(), 1);
  assert.equal(w.p.refreshAggregates(), 0, "unchanged inputs are idempotent");
  const [item] = w.p.latestPrices({ unit: "NUT" }) as any[];
  assert.equal(item.range.reference.amountPaise, 3050);
  assert.equal(item.freshness, "CURRENT");
  assert.equal(item.disclaimerKey, "price.not_offer");
  const ev = w.p.priceEvidence("prod_mature_coconut", "market_pollachi", "NUT", "FARM_GATE");
  assert.equal(JSON.stringify(ev).includes(cs[0]!.org.organizationId), false);
  assert.equal(JSON.stringify(ev).includes("Trader"), false);
  // reproducible from stored inputs
  const agg = w.p.aggregates.get(ev.bucket)!.at(-1)!;
  const again = w.p.reproduceAggregate(agg);
  assert.equal(again.kind === "AGGREGATE" && again.aggregate.referencePaise, agg.referencePaise);
  assert.equal(w.p.priceHistory("prod_mature_coconut", "market_pollachi", "NUT", "FARM_GATE").length, 1);
  // MSP is a separate policy reference
  assert.equal(w.p.mspReferences()[0]!.isMarketQuote, false);

  // Source failure: last-known value remains but is labelled stale with low confidence
  w.clock.advanceHours(24 * 5);
  const [stale] = w.p.latestPrices({ unit: "NUT" }) as any[];
  assert.equal(stale.freshness, "STALE");
  assert.equal(stale.confidence, "LOW");
});

test("contributor scope, executable quote rules and anomaly review", () => {
  const w = makeWorld();
  const c = contributor(w, "9111111111", "T");
  assert.throws(() => w.p.submitQuote(c.user, quote(c.org.organizationId, 3000, { marketId: "market_udumalpet" })), /scope/i);
  assert.throws(() => w.p.submitQuote(c.user, quote(c.org.organizationId, 3000, { expiresAt: undefined })), /EXPIRY/);
  const outsider = w.login("9444444444");
  assert.throws(() => w.p.submitQuote(outsider.user, quote(c.org.organizationId, 3000)), /contributor/i);
  // history then a 10x jump → NEEDS_REVIEW, and nobody but an operator can approve it
  for (const [i, ph] of ["9555555555", "9666666666", "9777777777"].entries()) {
    const x = contributor(w, ph, `O${i}`);
    w.p.submitQuote(x.user, quote(x.org.organizationId, 3000 + i * 10, { observedAt: "2026-09-30T04:00:00Z" }));
  }
  const spike = w.p.submitQuote(c.user, quote(c.org.organizationId, 30500));
  assert.equal(spike.state, "NEEDS_REVIEW");
  assert.throws(() => w.p.reviewObservation(c.user, c.session, spike.observationId, "APPROVE", "mine"), /permitted|forbidden|Not permitted/i);
  const ops = w.operator();
  assert.equal(w.p.listQueue(ops.user, ops.session, "PRICE_REVIEW")[0]!.priority, 1);
  assert.equal(w.p.reviewObservation(ops.user, ops.session, spike.observationId, "REJECT", "Per-nut vs per-kg unit error").state, "REJECTED");
  assert.ok(w.p.audit.some((a) => a.action === "OBSERVATION_REJECTD" || a.action.startsWith("OBSERVATION_")));
});

test("corrections supersede without mutating the original and recompute", () => {
  const w = makeWorld();
  const cs = ["9111111111", "9222222222", "9333333333"].map((ph, i) => contributor(w, ph, `T${i}`));
  const obs = cs.map((c, i) => w.p.submitQuote(c.user, quote(c.org.organizationId, 3000 + i * 50)));
  w.p.refreshAggregates();
  const before = w.p.aggregates.get([...w.p.aggregates.keys()][0]!)!.length;
  const originalRef = obs[2]!.referencePaise;
  const out = w.p.correctObservation(cs[2]!.user, cs[2]!.session, obs[2]!.observationId, { lowPaise: 3200, highPaise: 3400, referencePaise: 3300 }, "typo");
  assert.equal(out.replacement.supersedes, obs[2]!.observationId);
  assert.equal(w.p.observations.get(obs[2]!.observationId)!.referencePaise, originalRef);
  assert.equal(w.p.aggregates.get([...w.p.aggregates.keys()][0]!)!.length, before + 1);
  assert.throws(() => w.p.correctObservation(cs[2]!.user, cs[2]!.session, obs[0]!.observationId, { lowPaise: 1, highPaise: 2 }, "x"), /permitted|step/i);
});

test("revoking contributor approval removes quote rights", () => {
  const w = makeWorld();
  const c = contributor(w, "9111111111", "T");
  const claim = [...w.p.claims.values()].find((x) => x.type === "PRICE_CONTRIBUTOR_SCOPE")!;
  const ops = w.operator("+919000000002");
  w.p.decideClaim(ops.user, ops.session, claim.claimId, "REVOKED", "ABUSE");
  assert.throws(() => w.p.submitQuote(c.user, quote(c.org.organizationId, 3000)), /contributor|permitted/i);
});

test("alerts need consent, do not spam, re-arm, pause and cancel", () => {
  const w = makeWorld();
  const cs = ["9111111111", "9222222222", "9333333333"].map((ph, i) => contributor(w, ph, `T${i}`));
  cs.forEach((c, i) => w.p.submitQuote(c.user, quote(c.org.organizationId, 3000 + i * 50)));
  w.p.refreshAggregates();
  const u = w.login("9888888888").user;
  const base = { productId: "prod_mature_coconut", marketId: "market_pollachi", unit: "NUT", stage: "FARM_GATE", direction: "ABOVE", thresholdPaise: 3000, channel: "SMS", consent: true } as const;
  assert.throws(() => w.p.createAlert(u, { ...base, consent: false }), /Consent/);
  const a = w.p.createAlert(u, base);
  assert.equal(w.p.evaluateAlerts(), 1);
  assert.equal(w.p.evaluateAlerts(), 0, "repeat observation inside threshold must not re-notify");
  const n = w.p.notifications.at(-1)!;
  assert.ok(n.data.observedAt && n.data.link);
  w.p.setAlertStatus(u, a.alertId, "PAUSED");
  assert.equal(w.p.evaluateAlerts(), 0);
  w.p.setAlertStatus(u, a.alertId, "CANCELLED");
  assert.throws(() => w.p.setAlertStatus(u, a.alertId, "ACTIVE"));
  const other = w.login("9999999999").user;
  assert.throws(() => w.p.setAlertStatus(other, a.alertId, "PAUSED"), /not found/i);
});

test("source health: failures degrade status without erasing data and redact keys", () => {
  const w = makeWorld();
  w.p.ingestRaw("agmarknet", [rec()]);
  assert.equal(w.p.sourceStatus("agmarknet"), "HEALTHY");
  w.p.recordSourceFailure("agmarknet", "GET https://x?api-key=SECRET failed");
  assert.equal(w.p.sourceStatus("agmarknet"), "DELAYED");
  w.p.recordSourceFailure("agmarknet", "e"); w.p.recordSourceFailure("agmarknet", "e");
  assert.equal(w.p.sourceStatus("agmarknet"), "DEGRADED");
  const ops = w.operator();
  const h = w.p.listSourceHealth(ops.user, ops.session);
  assert.equal(JSON.stringify(h).includes("SECRET"), false);
  w.clock.advanceHours(100);
  w.p.sourceHealth.get("agmarknet")!.consecutiveFailures = 0;
  assert.equal(w.p.sourceStatus("agmarknet"), "STALE");
  assert.equal(w.p.observations.size, 1, "last-known observation retained");
});
