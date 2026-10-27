import test from "node:test";
import assert from "node:assert/strict";
import { bucketKey, type Aggregate, type PriceObservation } from "@livecoco/domain";
import { makeWorld, type World } from "@livecoco/test-support";

const rec = (over: Record<string, unknown> = {}) => ({ state: "Tamil Nadu", district: "Coimbatore", market: "Pollachi", commodity: "Coconut", variety: "Other", grade: "FAQ", arrival_date: "01/10/2026", min_price: "2900", max_price: "3200", modal_price: "3050", price_unit: "Rs./Quintal", ...over });

async function contributor(w: World, phone: string, orgName: string) {
  const a = await w.login(phone);
  const org = await w.as(a).identity.createOrganization(orgName, "TRADER");
  await w.verify(a, "PRICE_CONTRIBUTOR_SCOPE", { marketId: "market_pollachi", productId: "prod_mature_coconut" });
  return { ...a, org };
}
const contributors = async (w: World, phones: string[], prefix: string) => {
  const out = [];
  for (const [i, ph] of phones.entries()) out.push(await contributor(w, ph, `${prefix}${i}`));
  return out;
};
const quote = (orgId: string, ref: number, over: Record<string, unknown> = {}) => ({
  productId: "prod_mature_coconut" as const, marketId: "market_pollachi", gradeGroup: "FAQ", unit: "NUT" as const, stage: "FARM_GATE" as const, tradeTerm: "EX_FARM" as const,
  lowPaise: ref - 100, highPaise: ref + 100, referencePaise: ref, observedAt: "2026-10-01T04:00:00Z", quantity: "2000", expiresAt: "2026-10-02T04:00:00Z", organizationId: orgId, ...over,
});
const observations = (w: World) => w.find<PriceObservation>("price_observations");

test("official record: raw stored first, source date kept, replay is idempotent, unit semantics preserved", async () => {
  const w = makeWorld();
  const r1 = await w.sys.prices.ingestRaw("agmarknet", [rec()]);
  assert.equal(r1.observations, 1);
  const r2 = await w.sys.prices.ingestRaw("agmarknet", [rec()]);
  assert.deepEqual([r2.stored, r2.duplicates], [0, 1]);
  const [o] = await observations(w);
  assert.equal(o!.unit, "QUINTAL");
  assert.equal(o!.observedAt, "2026-10-01T04:30:00.000Z");
  assert.equal(o!.lowPaise, 290000);
  // A record arriving today with an older market date stays old
  w.clock.advanceHours(24 * 10);
  await w.sys.prices.ingestRaw("agmarknet", [rec({ arrival_date: "01/10/2026", modal_price: "3051" })]);
  const all = await observations(w);
  assert.equal(all.length, 2);
  const latest = all.find((x) => x.referencePaise === 305100)!;
  assert.equal(latest.observedAt, "2026-10-01T04:30:00.000Z");
});

test("unmapped source values go to a review queue and are never guessed", async () => {
  const w = makeWorld();
  const r = await w.sys.prices.ingestRaw("agmarknet", [rec({ commodity: "Mystery Fruit" }), rec({ market: "Narnia" }), rec({ price_unit: "Rs./Bag" }), rec({ min_price: "abc" })]);
  assert.equal(r.unmapped, 4);
  assert.equal((await observations(w)).length, 0);
  const ops = await w.operator();
  const q = await w.as(ops).operations.listQueue("MAPPING");
  assert.equal(q.length, 4);
  // operator resolves one explicitly
  let mystery: (typeof q)[number] | undefined;
  for (const i of q) if ((await w.get<{ payload: Record<string, unknown> }>("raw_records", i.subject))!.payload.commodity === "Mystery Fruit") mystery = i;
  assert.ok(mystery);
  const other = q.find((i) => i.queueItemId !== mystery.queueItemId)!;
  const done = await w.as(ops).prices.resolveMapping(mystery.queueItemId, { productId: "prod_mature_coconut", marketId: "market_pollachi", unit: "QUINTAL" }, "Confirmed with source");
  assert.equal(done.state, "ELIGIBLE");
  await assert.rejects(() => w.as(ops).prices.resolveMapping(other.queueItemId, { productId: "prod_mature_coconut", marketId: "market_pollachi", unit: "QUINTAL" }, ""), /reason/i);
});

test("end-to-end: contributors + official data aggregate, evidence is anonymous, thin evidence falls back", async () => {
  const w = makeWorld();
  const cs = await contributors(w, ["9111111111", "9222222222", "9333333333"], "Trader ");
  await w.sys.prices.ingestRaw("agmarknet", [rec({ commodity: "Coconut", price_unit: "Rs./Quintal" })]);
  // Official record is per quintal so it must not join the per-nut bucket
  assert.equal(await w.sys.prices.refreshAggregates(), 0);
  const thin = await w.sys.prices.latestPrices({ productId: "prod_mature_coconut", unit: "QUINTAL" });
  assert.equal(thin[0]!.kind, "OFFICIAL_OBSERVATION_ONLY");
  assert.equal(thin[0]!.messageKey, "price.insufficient");

  await w.as(cs[0]!).prices.submitQuote(quote(cs[0]!.org.organizationId, 3000));
  await w.as(cs[1]!).prices.submitQuote(quote(cs[1]!.org.organizationId, 3050));
  assert.equal(await w.sys.prices.refreshAggregates(), 0, "two sources are below the minimum");
  assert.equal((await w.sys.prices.latestPrices({ unit: "NUT" })).length, 0);
  await w.as(cs[2]!).prices.submitQuote(quote(cs[2]!.org.organizationId, 3100));
  assert.equal(await w.sys.prices.refreshAggregates(), 1);
  assert.equal(await w.sys.prices.refreshAggregates(), 0, "unchanged inputs are idempotent");
  const [item] = (await w.sys.prices.latestPrices({ unit: "NUT" })) as any[];
  assert.equal(item.range.reference.amountPaise, 3050);
  assert.equal(item.freshness, "CURRENT");
  assert.equal(item.disclaimerKey, "price.not_offer");
  const ev = await w.sys.prices.priceEvidence("prod_mature_coconut", "market_pollachi", "NUT", "FARM_GATE");
  assert.equal(JSON.stringify(ev).includes(cs[0]!.org.organizationId), false);
  assert.equal(JSON.stringify(ev).includes("Trader"), false);
  // reproducible from stored inputs
  const agg = (await w.get<{ history: Aggregate[] }>("price_aggregates", ev.bucket))!.history.at(-1)!;
  const again = await w.sys.prices.reproduceAggregate(agg);
  assert.equal(again.kind === "AGGREGATE" && again.aggregate.referencePaise, agg.referencePaise);
  assert.equal((await w.sys.prices.priceHistory("prod_mature_coconut", "market_pollachi", "NUT", "FARM_GATE")).length, 1);
  // MSP is a separate policy reference
  assert.equal(w.app.services.prices.mspReferences()[0]!.isMarketQuote, false);

  // Source failure: last-known value remains but is labelled stale with low confidence
  w.clock.advanceHours(24 * 5);
  const [stale] = (await w.sys.prices.latestPrices({ unit: "NUT" })) as any[];
  assert.equal(stale.freshness, "STALE");
  assert.equal(stale.confidence, "LOW");
});

test("contributor scope, executable quote rules and anomaly review", async () => {
  const w = makeWorld();
  const c = await contributor(w, "9111111111", "T");
  await assert.rejects(() => w.as(c).prices.submitQuote(quote(c.org.organizationId, 3000, { marketId: "market_udumalpet" })), /scope/i);
  await assert.rejects(() => w.as(c).prices.submitQuote(quote(c.org.organizationId, 3000, { expiresAt: undefined })), /EXPIRY/);
  const outsider = await w.login("9444444444");
  await assert.rejects(() => w.as(outsider).prices.submitQuote(quote(c.org.organizationId, 3000)), /contributor/i);
  // history then a 10x jump → NEEDS_REVIEW, and nobody but an operator can approve it
  for (const [i, ph] of ["9555555555", "9666666666", "9777777777"].entries()) {
    const x = await contributor(w, ph, `O${i}`);
    await w.as(x).prices.submitQuote(quote(x.org.organizationId, 3000 + i * 10, { observedAt: "2026-09-30T04:00:00Z" }));
  }
  const spike = await w.as(c).prices.submitQuote(quote(c.org.organizationId, 30500));
  assert.equal(spike.state, "NEEDS_REVIEW");
  await assert.rejects(() => w.as(c).prices.reviewObservation(spike.observationId, "APPROVE", "mine"), /permitted|forbidden|Not permitted/i);
  const ops = await w.operator();
  assert.equal((await w.as(ops).operations.listQueue("PRICE_REVIEW"))[0]!.priority, 1);
  assert.equal((await w.as(ops).prices.reviewObservation(spike.observationId, "REJECT", "Per-nut vs per-kg unit error")).state, "REJECTED");
  assert.ok((await w.log<{ action: string }>("audit_log")).some((a) => a.action === "OBSERVATION_REJECTD" || a.action.startsWith("OBSERVATION_")));
});

test("corrections supersede without mutating the original and recompute", async () => {
  const w = makeWorld();
  const cs = await contributors(w, ["9111111111", "9222222222", "9333333333"], "T");
  const obs: PriceObservation[] = [];
  for (const [i, c] of cs.entries()) obs.push(await w.as(c).prices.submitQuote(quote(c.org.organizationId, 3000 + i * 50)));
  await w.sys.prices.refreshAggregates();
  const history = async () => (await w.get<{ history: Aggregate[] }>("price_aggregates", bucketKey(obs[0]!)))!.history;
  const before = (await history()).length;
  const originalRef = obs[2]!.referencePaise;
  const out = await w.as(cs[2]!).prices.correctObservation(obs[2]!.observationId, { lowPaise: 3200, highPaise: 3400, referencePaise: 3300 }, "typo");
  assert.equal(out.replacement.supersedes, obs[2]!.observationId);
  assert.equal((await w.get<PriceObservation>("price_observations", obs[2]!.observationId))!.referencePaise, originalRef);
  assert.equal((await history()).length, before + 1);
  await assert.rejects(() => w.as(cs[2]!).prices.correctObservation(obs[0]!.observationId, { lowPaise: 1, highPaise: 2 }, "x"), /permitted|step/i);
});

test("revoking contributor approval removes quote rights", async () => {
  const w = makeWorld();
  const c = await contributor(w, "9111111111", "T");
  const [claim] = await w.find<{ claimId: string }>("verification_claims", { type: "PRICE_CONTRIBUTOR_SCOPE" });
  const ops = await w.operator("+919000000002");
  await w.as(ops).identity.decideClaim(claim!.claimId, "REVOKED", "ABUSE");
  await assert.rejects(() => w.as(c).prices.submitQuote(quote(c.org.organizationId, 3000)), /contributor|permitted/i);
});

test("alerts need consent, do not spam, re-arm, pause and cancel", async () => {
  const w = makeWorld();
  const cs = await contributors(w, ["9111111111", "9222222222", "9333333333"], "T");
  for (const [i, c] of cs.entries()) await w.as(c).prices.submitQuote(quote(c.org.organizationId, 3000 + i * 50));
  await w.sys.prices.refreshAggregates();
  const u = await w.login("9888888888");
  const base = { productId: "prod_mature_coconut", marketId: "market_pollachi", unit: "NUT", stage: "FARM_GATE", direction: "ABOVE", thresholdPaise: 3000, channel: "SMS", consent: true } as const;
  await assert.rejects(() => w.as(u).alerts.create({ ...base, consent: false }), /Consent/);
  const a = await w.as(u).alerts.create(base);
  assert.equal(await w.sys.alerts.evaluate(), 1);
  assert.equal(await w.sys.alerts.evaluate(), 0, "repeat observation inside threshold must not re-notify");
  const n = (await w.log<{ data: Record<string, unknown> }>("notifications")).at(-1)!;
  assert.ok(n.data.observedAt && n.data.link);
  await w.as(u).alerts.setStatus(a.alertId, "PAUSED");
  assert.equal(await w.sys.alerts.evaluate(), 0);
  await w.as(u).alerts.setStatus(a.alertId, "CANCELLED");
  await assert.rejects(() => w.as(u).alerts.setStatus(a.alertId, "ACTIVE"));
  const other = await w.login("9999999999");
  await assert.rejects(() => w.as(other).alerts.setStatus(a.alertId, "PAUSED"), /not found/i);
});

test("source health: failures degrade status without erasing data and redact keys", async () => {
  const w = makeWorld();
  await w.sys.prices.ingestRaw("agmarknet", [rec()]);
  assert.equal(await w.sys.prices.sourceStatus("agmarknet"), "HEALTHY");
  await w.sys.prices.recordSourceFailure("agmarknet", "GET https://x?api-key=SECRET failed");
  assert.equal(await w.sys.prices.sourceStatus("agmarknet"), "DELAYED");
  await w.sys.prices.recordSourceFailure("agmarknet", "e"); await w.sys.prices.recordSourceFailure("agmarknet", "e");
  assert.equal(await w.sys.prices.sourceStatus("agmarknet"), "DEGRADED");
  const ops = await w.operator();
  const h = await w.as(ops).prices.listSourceHealth();
  assert.equal(JSON.stringify(h).includes("SECRET"), false);
  w.clock.advanceHours(100);
  await w.run(async (s) => {
    const cur = (await s.tx.get<{ consecutiveFailures: number }>("source_health", "agmarknet"))!;
    s.tx.put("source_health", "agmarknet", { ...cur, consecutiveFailures: 0 });
  });
  assert.equal(await w.sys.prices.sourceStatus("agmarknet"), "STALE");
  assert.equal((await observations(w)).length, 1, "last-known observation retained");
});
