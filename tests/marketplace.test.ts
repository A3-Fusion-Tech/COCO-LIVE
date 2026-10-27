import test from "node:test";
import assert from "node:assert/strict";
import { hoursFromNow, makeWorld, sampleTerms, type Login } from "@livecoco/test-support";
import { reputationSummary, type Offer, type ReputationEvent, type SellLot } from "@livecoco/domain";

interface AuditRow { action: string; reason?: string }

async function setup(extra: Parameters<typeof makeWorld>[0] = {}) {
  const w = makeWorld(extra);
  const seller = await w.login("9100000001");
  const buyer = await w.login("9100000002");
  await w.verify(seller, "PERSON_IDENTITY");
  await w.verify(buyer, "ORGANIZATION_EXISTENCE");
  const lotInput = (over: Record<string, unknown> = {}) => ({
    productId: "prod_mature_coconut" as const, gradeAttributes: { husk: "WITH_HUSK" }, gradeGroup: "FAQ", unit: "NUT" as const, quantityTotal: "10000", partialFulfilmentAllowed: true,
    originMarketId: "market_anaimalai", preciseLocation: { lat: 10.59, lon: 76.94 }, availableFrom: "2026-10-02T04:00:00Z", availableTo: "2026-10-06T04:00:00Z", expiresAt: hoursFromNow(w.clock, 72),
    fulfilment: { mode: "PICKUP" as const, costsIncluded: ["LOADING"], costsExcluded: ["TRANSPORT"] }, priceExpectation: { unitPricePaise: 3000 }, ...over,
  });
  const activeLot = async (over: Record<string, unknown> = {}, who: Login = seller) => {
    const lot = await w.as(who).lots.create(lotInput(over));
    await w.as(who).lots.addPhoto(lot.sellLotId);
    return w.as(who).lots.activate(lot.sellLotId);
  };
  const lotOf = async (id: string) => (await w.get<SellLot>("sell_lots", id))!;
  const offerOf = async (id: string) => (await w.get<Offer>("offers", id))!;
  const audited = async (action: string) => w.log<AuditRow>("audit_log", { action });
  return { w, seller, buyer, lotInput, activeLot, lotOf, offerOf, audited };
}

test("lot lifecycle: validation, photo rule, review for new participants, expiry, withdrawal, privacy", async () => {
  const { w, seller, lotInput } = await setup();
  const lot = await w.as(seller).lots.create(lotInput({ gradeAttributes: {} }));
  await assert.rejects(() => w.as(seller).lots.activate(lot.sellLotId), /MISSING_ATTRIBUTE_HUSK.*PHOTO_REQUIRED/);
  await w.as(seller).lots.update(lot.sellLotId, { gradeAttributes: { husk: "DEHUSKED" } });
  await w.as(seller).lots.addPhoto(lot.sellLotId);
  assert.equal((await w.as(seller).lots.activate(lot.sellLotId)).status, "ACTIVE");

  // photo exception only by an approved operator with justification
  const l2 = await w.as(seller).lots.create(lotInput());
  await assert.rejects(() => w.as(seller).lots.activate(l2.sellLotId), /PHOTO_REQUIRED/);
  const ops = await w.operator();
  await assert.rejects(() => w.as(ops).lots.grantPhotoException(l2.sellLotId, ""), /justification/i);
  await w.as(ops).lots.grantPhotoException(l2.sellLotId, "Remote farm, no signal; verified by phone");
  assert.equal((await w.as(seller).lots.activate(l2.sellLotId)).status, "ACTIVE");

  // public view hides precise location and seller id
  const pub = JSON.stringify(await w.sys.lots.search());
  assert.equal(pub.includes("preciseLocation"), false);
  assert.equal(pub.includes(seller.user.userId), false);
  assert.ok(pub.includes("Identity") === false && pub.includes("claim.PERSON_IDENTITY"));

  // new participant goes to review
  const newbie = await w.login("9100000009");
  const nl = await w.as(newbie).lots.create(lotInput());
  await w.as(newbie).lots.addPhoto(nl.sellLotId);
  assert.equal((await w.as(newbie).lots.activate(nl.sellLotId)).status, "PENDING_REVIEW");
  assert.equal((await w.sys.lots.search()).some((l) => l.sellLotId === nl.sellLotId), false);
  assert.equal((await w.as(ops).lots.review(nl.sellLotId, "APPROVE", "docs ok")).status, "ACTIVE");

  // other users cannot edit; expiry; withdraw
  await assert.rejects(() => w.as(newbie).lots.update(lot.sellLotId, { quantityTotal: "1" }), /not found/i);
  w.clock.advanceHours(100);
  assert.deepEqual((await w.sys.maintenance.runExpiry()).lots >= 2, true);
  assert.equal((await w.sys.lots.search()).length, 0);
  const x = await w.as(seller).lots.create(lotInput({ expiresAt: hoursFromNow(w.clock, 24) }));
  await w.as(seller).lots.addPhoto(x.sellLotId);
  const l3 = await w.as(seller).lots.activate(x.sellLotId);
  assert.equal((await w.as(seller).lots.withdraw(l3.sellLotId)).status, "WITHDRAWN");
  await assert.rejects(() => w.as(seller).lots.withdraw(l3.sellLotId));
});

test("agent disclosure and org membership are enforced", async () => {
  const { w, seller, lotInput } = await setup();
  const lot = await w.as(seller).lots.create(lotInput({ listedOnBehalfOf: "" }));
  await w.as(seller).lots.addPhoto(lot.sellLotId);
  await assert.rejects(() => w.as(seller).lots.activate(lot.sellLotId), /AGENT_DISCLOSURE_REQUIRED/);
  await assert.rejects(() => w.as(seller).lots.create(lotInput({ organizationId: "org_other" })), /Not a member|member/i);
});

test("requirements: verified buyers only, validation, recurrence, close", async () => {
  const { w, buyer, seller } = await setup();
  const input = { productId: "prod_mature_coconut" as const, gradeGroup: "FAQ", unit: "NUT" as const, targetQuantity: "8000", minQuantity: "4000", partialAllowed: true, destinationMarketId: "market_pollachi", maxRadiusKm: 40, requiredFrom: "2026-10-03T00:00:00Z", requiredBy: "2026-10-07T00:00:00Z", expiresAt: hoursFromNow(w.clock, 96), maxUnitPricePaise: 3200 };
  const unverified = await w.login("9100000008");
  await assert.rejects(() => w.as(unverified).requirements.create(input), /verification/i);
  await assert.rejects(() => w.as(buyer).requirements.create({ ...input, minQuantity: "9000" }), /MIN_EXCEEDS_TARGET/);
  await assert.rejects(() => w.as(buyer).requirements.create({ ...input, unit: "QUINTAL" as never, productId: "prod_tender_coconut" as never }), /UNIT_NOT_SUPPORTED/);
  const r = await w.as(buyer).requirements.create(input);
  assert.equal(r.status, "ACTIVE");
  const rec = await w.as(buyer).requirements.createRecurring(input, "WEEKLY", 3);
  assert.equal(rec.instances.length, 3);
  assert.equal(Date.parse(rec.instances[1]!.requiredFrom) - Date.parse(rec.instances[0]!.requiredFrom), 7 * 86_400_000);
  const added = await w.as(buyer).requirements.extendRecurrence(rec.template.templateId, { targetQuantity: "9000" }, 1);
  assert.equal(added.length, 1);
  assert.equal(added[0]!.targetQuantity, "9000");
  const first = await w.as(buyer).requirements.get(rec.instances[0]!.requirementId);
  assert.equal(first.targetQuantity, "8000", "editing a template affects only future instances");
  assert.equal((await w.as(buyer).requirements.close(r.requirementId)).status, "CLOSED");
  await assert.rejects(() => w.as(seller).requirements.close(r.requirementId), /not found/i);
});

test("matching is explainable, excludes blocked/suspended/expired and never commits a trade", async () => {
  const { w, seller, buyer, activeLot } = await setup();
  const lot = await activeLot();
  const input = { productId: "prod_mature_coconut" as const, gradeGroup: "FAQ", unit: "NUT" as const, targetQuantity: "8000", minQuantity: "4000", partialAllowed: true, destinationMarketId: "market_pollachi", maxRadiusKm: 40, requiredFrom: "2026-10-03T00:00:00Z", requiredBy: "2026-10-07T00:00:00Z", expiresAt: hoursFromNow(w.clock, 96), maxUnitPricePaise: 3200 };
  const req = await w.as(buyer).requirements.create(input);
  const m = await w.as(buyer).requirements.matchesForRequirement(req.requirementId);
  assert.equal(m.length, 1);
  assert.ok(m[0]!.reasons.includes("PRODUCT_EXACT") && m[0]!.reasons.includes("GRADE_EXACT") && m[0]!.reasons.includes("PRICE_OVERLAP"));
  assert.ok(m[0]!.reasons.some((r) => /^QUANTITY_COVERS_100_PERCENT$/.test(r)));
  assert.ok(m[0]!.reasons.some((r) => /^PICKUP_WITHIN_\d+_KM$/.test(r)));
  assert.equal((await w.find("deals")).length + (await w.find("offers")).length, 0);
  // far away requirement is incompatible and operators can see why
  const far = await w.as(buyer).requirements.create({ ...input, maxRadiusKm: 1 });
  const ops = await w.operator();
  const ineligible = await w.as(ops).requirements.operatorMatches(far.requirementId);
  assert.ok(ineligible[0]!.incompatibilities.includes("OUTSIDE_RADIUS"));
  assert.equal((await w.as(buyer).requirements.matchesForRequirement(far.requirementId)).length, 0);
  // price mismatch
  const cheap = await w.as(buyer).requirements.create({ ...input, maxUnitPricePaise: 2000 });
  assert.ok((await w.as(ops).requirements.operatorMatches(cheap.requirementId))[0]!.incompatibilities.includes("PRICE_NO_OVERLAP"));
  // seller view of matches hides incompatibility detail
  assert.ok((await w.as(seller).requirements.matchesForLot(lot.sellLotId)).length >= 1);
  // blocked → excluded
  await w.as(seller).operations.block(buyer.user.userId);
  assert.equal((await w.as(buyer).requirements.matchesForRequirement(req.requirementId)).length, 0);
  // suspended seller → excluded (first lift the block directly in stored state; there is no unblock operation)
  await w.run(async (s) => { const u = (await s.tx.get<typeof seller.user>("users", seller.user.userId))!; s.tx.put("users", u.userId, { ...u, blocked: [] }); });
  assert.equal((await w.as(buyer).requirements.matchesForRequirement(req.requirementId)).length, 1, "unblocking restores the match");
  await w.as(ops).operations.suspend(seller.user.userId, "fraud signal");
  assert.equal((await w.as(buyer).requirements.matchesForRequirement(req.requirementId)).length, 0);
  await assert.rejects(() => w.sys.identity.authenticate(seller.token), /Authentication|suspended/i);
});

test("offers: validation, counter-offer chain is immutable, expiry and wrong-party actions", async () => {
  const { w, seller, buyer, activeLot, offerOf } = await setup();
  const lot = await activeLot();
  const stranger = await w.login("9100000007");
  await w.verify(stranger, "PERSON_IDENTITY");
  const exp = hoursFromNow(w.clock, 6);
  await assert.rejects(() => w.as(buyer).offers.create({ sellLotId: lot.sellLotId, terms: sampleTerms({ quantity: "20000" }), expiresAt: exp }), /QUANTITY_EXCEEDS_AVAILABLE/);
  await assert.rejects(() => w.as(buyer).offers.create({ sellLotId: lot.sellLotId, terms: sampleTerms({ unit: "KG" }), expiresAt: exp }), /UNIT_MISMATCH/);
  await assert.rejects(() => w.as(buyer).offers.create({ sellLotId: lot.sellLotId, terms: sampleTerms(), expiresAt: hoursFromNow(w.clock, 500) }), /EXPIRY_TOO_LONG/);
  await assert.rejects(() => w.as(buyer).offers.create({ sellLotId: lot.sellLotId, terms: sampleTerms({ costsIncluded: [], costsExcluded: [] }), expiresAt: exp }), /COSTS_NOT_STATED/);
  await assert.rejects(() => w.as(seller).offers.create({ sellLotId: lot.sellLotId, terms: sampleTerms(), expiresAt: exp }), /own lot/);
  const unverified = await w.login("9100000006");
  await assert.rejects(() => w.as(unverified).offers.create({ sellLotId: lot.sellLotId, terms: sampleTerms(), expiresAt: exp }), /verification/i);

  const o1 = await w.as(buyer).offers.create({ sellLotId: lot.sellLotId, terms: sampleTerms(), expiresAt: exp });
  assert.equal(o1.estimatedTotalPaise, 15_000_000);
  await assert.rejects(() => w.as(buyer).offers.create({ sellLotId: lot.sellLotId, terms: sampleTerms(), expiresAt: exp }), /active offer/i);
  await assert.rejects(() => w.as(buyer).offers.accept(o1.offerId), /own offer/);
  await assert.rejects(() => w.as(stranger).offers.accept(o1.offerId), /not found/i);
  const o2 = await w.as(seller).offers.counter(o1.offerId, sampleTerms({ unitPricePaise: 3100 }), exp);
  assert.equal(o2.revision, 2);
  assert.equal(o2.previousOfferId, o1.offerId);
  assert.equal((await offerOf(o1.offerId)).status, "COUNTERED");
  assert.equal((await offerOf(o1.offerId)).terms.unitPricePaise, 3000, "prior revision untouched");
  const loaded = await w.as(buyer).offers.get(o1.offerId);
  assert.throws(() => (loaded.terms as { unitPricePaise: number }).unitPricePaise = 1, TypeError);
  await assert.rejects(() => w.as(seller).offers.accept(o1.offerId), /countered/i);
  await assert.rejects(() => w.as(seller).offers.counter(o2.offerId, sampleTerms(), exp), /own offer/);
  // expiry
  w.clock.advanceHours(7);
  await assert.rejects(() => w.as(buyer).offers.accept(o2.offerId), /expired/i);
  assert.equal((await w.sys.maintenance.runExpiry()).offers, 1);
});

test("acceptance reserves quantity atomically and cannot oversell", async () => {
  const { w, seller, buyer, activeLot, lotOf, offerOf } = await setup();
  const lot = await activeLot({ quantityTotal: "10000", partialFulfilmentAllowed: true });
  const buyer2 = await w.login("9100000005");
  await w.verify(buyer2, "PERSON_IDENTITY");
  const exp = hoursFromNow(w.clock, 6);
  const a = await w.as(buyer).offers.create({ sellLotId: lot.sellLotId, terms: sampleTerms({ quantity: "7000" }), expiresAt: exp });
  const b = await w.as(buyer2).offers.create({ sellLotId: lot.sellLotId, terms: sampleTerms({ quantity: "6000" }), expiresAt: exp });
  const deal = await w.as(seller).offers.accept(a.offerId);
  assert.equal(deal.status, "AGREED");
  assert.equal((await lotOf(lot.sellLotId)).quantityReserved, "7000");
  assert.equal((await offerOf(b.offerId)).status, "INVALIDATED", "offer larger than remaining quantity is invalidated");
  await assert.rejects(() => w.as(seller).offers.accept(b.offerId), /not active|INVALIDATED/i);
  // a smaller offer still fits
  const c = await w.as(buyer2).offers.create({ sellLotId: lot.sellLotId, terms: sampleTerms({ quantity: "3000" }), expiresAt: exp });
  await assert.rejects(() => w.as(seller).lots.update(lot.sellLotId, { quantityTotal: "5000" }), /reserved/i);
  const deal2 = await w.as(seller).offers.accept(c.offerId);
  assert.equal((await lotOf(lot.sellLotId)).quantityReserved, "10000");
  assert.equal(deal2.cards[0]!.terms.quantity, "3000");
  await assert.rejects(() => w.as(buyer).offers.create({ sellLotId: lot.sellLotId, terms: sampleTerms({ quantity: "1" }), expiresAt: exp }), /QUANTITY_EXCEEDS_AVAILABLE/);
  await assert.rejects(() => w.as(seller).lots.withdraw(lot.sellLotId), /reserved/i);
});

test("material lot edits invalidate open offers and create a revision; version conflicts are detected", async () => {
  const { w, seller, buyer, activeLot, offerOf } = await setup();
  const lot = await activeLot();
  const o = await w.as(buyer).offers.create({ sellLotId: lot.sellLotId, terms: sampleTerms(), expiresAt: hoursFromNow(w.clock, 6) });
  await assert.rejects(() => w.as(seller).lots.update(lot.sellLotId, { expiresAt: hoursFromNow(w.clock, 90) }, 999), /changed by someone/);
  const nonMaterial = await w.as(seller).lots.update(lot.sellLotId, { expiresAt: hoursFromNow(w.clock, 90) });
  assert.equal(nonMaterial.materialRevision, false);
  assert.equal((await offerOf(o.offerId)).status, "ACTIVE");
  const mat = await w.as(seller).lots.update(lot.sellLotId, { priceExpectation: { unitPricePaise: 3500 } });
  assert.equal(mat.materialRevision, true);
  assert.equal((await offerOf(o.offerId)).status, "INVALIDATED");
});

test("contact reveal requires mutual interest, is rate limited and logged; block and report work", async () => {
  const { w, seller, buyer, activeLot, audited } = await setup();
  const lot = await activeLot();
  const exp = hoursFromNow(w.clock, 6);
  const o = await w.as(buyer).offers.create({ sellLotId: lot.sellLotId, terms: sampleTerms(), expiresAt: exp });
  await assert.rejects(() => w.as(buyer).offers.revealContact(o.threadId), /mutual interest/);
  await w.as(seller).offers.counter(o.offerId, sampleTerms({ unitPricePaise: 3050 }), exp);
  assert.equal((await w.as(buyer).offers.revealContact(o.threadId)).phone, seller.user.phone);
  assert.ok((await audited("CONTACT_REVEALED")).length > 0);
  const outsider = await w.login("9100000004");
  await assert.rejects(() => w.as(outsider).offers.revealContact(o.threadId), /not found/i);
  // rate limit: config is fixed per world, so replay one reveal in a world capped at 1 per day
  {
    const t = await setup({ contactRevealPerDay: 1 });
    const tl = await t.activeLot();
    const texp = hoursFromNow(t.w.clock, 6);
    const to = await t.w.as(t.buyer).offers.create({ sellLotId: tl.sellLotId, terms: sampleTerms(), expiresAt: texp });
    await t.w.as(t.seller).offers.counter(to.offerId, sampleTerms({ unitPricePaise: 3050 }), texp);
    assert.equal((await t.w.as(t.buyer).offers.revealContact(to.threadId)).phone, t.seller.user.phone);
    await assert.rejects(() => t.w.as(t.buyer).offers.revealContact(to.threadId), /limit/i);
  }
  const rep = await w.as(buyer).operations.report(seller.user.userId, "SPAM");
  assert.ok(rep.reportId);
  assert.ok((await w.find("ops_queue")).length > 0);
});

async function dealFlow() {
  const s = await setup();
  const lot = await s.activeLot();
  const exp = hoursFromNow(s.w.clock, 6);
  const o = await s.w.as(s.buyer).offers.create({ sellLotId: lot.sellLotId, terms: sampleTerms(), expiresAt: exp });
  const deal = await s.w.as(s.seller).offers.accept(o.offerId);
  /** The deal as stored now (frozen cards and events). */
  const view = () => s.w.as(s.buyer).deals.view(deal.dealId);
  return { ...s, lot, deal, view };
}

test("deal card is immutable; amendments need the counterparty; full happy path completes with reputation events", async () => {
  const { w, seller, buyer, deal, lot, view, lotOf } = await dealFlow();
  const d0 = await view();
  assert.throws(() => { (d0.cards[0]!.terms as { quantity: string }).quantity = "1"; }, TypeError);
  assert.throws(() => { (d0.events[0] as { type: string }).type = "X"; }, TypeError);
  await w.as(buyer).deals.proposeAmendment(deal.dealId, sampleTerms({ quantity: "4000" }));
  await assert.rejects(() => w.as(buyer).deals.respondAmendment(deal.dealId, true), /proposer/);
  await assert.rejects(() => w.as(seller).deals.confirmPickup(deal.dealId), /amendment/i);
  await w.as(seller).deals.respondAmendment(deal.dealId, true);
  const d1 = await view();
  assert.equal(d1.cards.length, 2);
  assert.equal(d1.cards[0]!.terms.quantity, "5000", "original revision preserved");
  assert.equal((await lotOf(lot.sellLotId)).quantityReserved, "4000");
  assert.equal(d1.cards[1]!.totalPaise, 12_000_000);
  await w.as(seller).deals.proposeAmendment(deal.dealId, sampleTerms({ quantity: "4000", unitPricePaise: 4000 }));
  await w.as(buyer).deals.respondAmendment(deal.dealId, false);
  assert.equal((await view()).cards.length, 2);

  await w.as(seller).deals.confirmPickup(deal.dealId);
  await w.as(seller).deals.addEvidence(deal.dealId, "WEIGHMENT_SLIP", "count 4000");
  await w.as(seller).deals.confirmDelivery(deal.dealId);
  await assert.rejects(() => w.as(seller).deals.acceptDelivery(deal.dealId), /buyer/i);
  await w.as(buyer).deals.acceptDelivery(deal.dealId);
  await assert.rejects(() => w.as(buyer).deals.confirmPayment(deal.dealId, "UPI"), /seller/i);
  await w.as(seller).deals.confirmPayment(deal.dealId, "UPI");
  assert.equal((await view()).events.find((e) => e.type === "PAYMENT_CONFIRMED")!.data!.guarantee, false);
  await w.as(buyer).deals.complete(deal.dealId);
  const done = await view();
  assert.equal(done.status, "COMPLETED");
  assert.deepEqual(done.events.map((e) => e.seq), done.events.map((_, i) => i + 1));
  await assert.rejects(() => w.as(buyer).deals.cancel(deal.dealId, "x"));
  assert.equal((await w.sys.reputation.publicSummary(seller.user.userId)).sufficientData, false, "small samples are not exposed");
  const events = Array.from({ length: 5 }, (_, i) => ({ partyId: "p", type: "DEAL_COMPLETED" as const, dealId: `d${i}`, at: "" }));
  assert.equal(reputationSummary(events, "p").sufficientData, true);
  // evidence access control
  const outsider = await w.login("9100000003");
  await assert.rejects(() => w.as(outsider).deals.evidence(deal.dealId), /not found/i);
  assert.equal((await w.as(buyer).deals.evidence(deal.dealId)).length, 1);
});

test("cancellation releases reserved quantity; invalid transitions are rejected", async () => {
  const { w, buyer, deal, lot, lotOf } = await dealFlow();
  await assert.rejects(() => w.as(buyer).deals.acceptDelivery(deal.dealId), /cannot move/);
  await assert.rejects(() => w.as(buyer).deals.cancel(deal.dealId, ""), /reason/i);
  await w.as(buyer).deals.cancel(deal.dealId, "Truck unavailable");
  assert.equal((await lotOf(lot.sellLotId)).quantityReserved, "0");
  assert.equal((await lotOf(lot.sellLotId)).status, "ACTIVE");
  assert.equal((await w.log<ReputationEvent>("reputation_events")).at(-1)!.type, "CANCELLED_BY_PARTY");
});

test("deemed acceptance only fires after the agreed window", async () => {
  const { w, seller, deal, view } = await dealFlow();
  await w.as(seller).deals.confirmDelivery(deal.dealId);
  w.clock.advanceHours(23);
  assert.equal((await w.sys.maintenance.runExpiry()).deemedAcceptances, 0);
  w.clock.advanceHours(2);
  assert.equal((await w.sys.maintenance.runExpiry()).deemedAcceptances, 1);
  assert.equal((await view()).status, "ACCEPTED");
  assert.equal((await w.sys.maintenance.runExpiry()).deemedAcceptances, 0);
});

test("disputes: window, structured fields, response, operator resolution without altering the card", async () => {
  const { w, seller, buyer, deal, view, audited } = await dealFlow();
  await w.as(seller).deals.confirmDelivery(deal.dealId);
  const cardBefore = JSON.stringify((await view()).cards);
  const ev = await w.as(buyer).deals.addEvidence(deal.dealId, "PHOTO", "damaged nuts");
  const outsider = await w.login("9100000011");
  await assert.rejects(() => w.as(outsider).deals.openDispute(deal.dealId, { reason: "DAMAGE" }), /not found/i);
  const dis = await w.as(buyer).deals.openDispute(deal.dealId, { reason: "DAMAGE", claimedQuantity: "500", claimedAmountPaise: 1_500_000, evidenceIds: [ev.evidenceId] });
  assert.equal((await view()).status, "DISPUTED");
  await assert.rejects(() => w.as(seller).deals.openDispute(deal.dealId, { reason: "NON_PAYMENT" }), /already exists/);
  await assert.rejects(() => w.as(seller).deals.complete(deal.dealId));
  await assert.rejects(() => w.as(outsider).deals.disputeForParty(dis.disputeId), /not found/i);
  const ops = await w.operator();
  await assert.rejects(() => w.as(ops).deals.resolveDispute(dis.disputeId, "UPHELD", "x"), /response window/i);
  // operators can see evidence for disputed deals only through an audited path
  assert.equal((await w.as(ops).deals.evidence(deal.dealId)).length, 1);
  assert.ok((await audited("DEAL_EVIDENCE_VIEWED")).length > 0);
  await w.as(seller).deals.respondDispute(dis.disputeId, "Weather damage after pickup", []);
  await assert.rejects(() => w.as(seller).deals.respondDispute(dis.disputeId, "again"), /already/i);
  await assert.rejects(() => w.as(ops).deals.resolveDispute(dis.disputeId, "UPHELD", ""), /reason/i);
  const res = await w.as(ops).deals.resolveDispute(dis.disputeId, "PARTIALLY_UPHELD", "Photos confirm 300 damaged");
  assert.equal(res.resolution!.operatorId, ops.user.userId);
  const after = await view();
  assert.equal(JSON.stringify(after.cards), cardBefore, "operators cannot alter the Deal Card");
  assert.equal(after.status, "ACCEPTED");
  await assert.rejects(() => w.as(ops).deals.resolveDispute(dis.disputeId, "UPHELD", "again"), /already/i);
  assert.ok((await audited("DISPUTE_RESOLVED")).some((a) => a.reason));
});

test("dispute window closes after delivery acceptance period (except payment/no-show)", async () => {
  const { w, seller, buyer, deal } = await dealFlow();
  await w.as(seller).deals.confirmDelivery(deal.dealId);
  w.clock.advanceHours(30);
  await assert.rejects(() => w.as(buyer).deals.openDispute(deal.dealId, { reason: "QUALITY_MISMATCH" }), /window/);
  assert.equal((await w.as(seller).deals.openDispute(deal.dealId, { reason: "NON_PAYMENT" })).reason, "NON_PAYMENT");
});

test("operator capabilities: separate, step-up required, audited, no self-decisions", async () => {
  const w = makeWorld();
  const user = await w.login("9200000001");
  await assert.rejects(() => w.as(user).operations.listQueue(), /permitted|Not permitted/i);
  const rawOps = await w.login("+919000000001");
  await assert.rejects(() => w.as(rawOps).operations.listQueue(), /Step-up/);
  const ops = await w.operator();
  assert.deepEqual(await w.as(ops).operations.listQueue(), []);
  const claim = await w.as(ops).identity.submitClaim("PERSON_IDENTITY", {}, ["doc"]);
  await assert.rejects(() => w.as(ops).identity.decideClaim(claim.claimId, "APPROVED", "OK"), /own claim/i);
  const other = await w.operator("+919000000002");
  assert.equal((await w.as(other).identity.decideClaim(claim.claimId, "APPROVED", "OK")).status, "APPROVED");
  await assert.rejects(() => w.as(other).identity.decideClaim(claim.claimId, "APPROVED", "OK"), /Claim is/);
  await assert.rejects(() => w.as(other).identity.decideClaim(claim.claimId, "REVOKED", ""), /reason/i);
  // sensitive documents: only owner or capability holder, access logged
  const doc = (await w.get<{ evidenceId: string }>("evidence", claim.evidenceIds[0]!))!;
  await assert.rejects(() => w.as(user).identity.accessEvidence(doc.evidenceId), /not found/i);
  assert.equal((await w.as(other).identity.accessEvidence(doc.evidenceId)).evidenceId, doc.evidenceId);
  assert.ok((await w.log<AuditRow>("audit_log", { action: "SENSITIVE_EVIDENCE_ACCESSED" })).length > 0);
  assert.ok((await w.as(ops).operations.readAudit()).length > 0);
  // public claim summary has no evidence
  assert.equal(JSON.stringify(await w.sys.identity.claimSummaries(ops.user.userId)).includes("evidence"), false);
});
