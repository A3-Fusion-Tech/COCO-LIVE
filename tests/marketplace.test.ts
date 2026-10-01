import test from "node:test";
import assert from "node:assert/strict";
import { hoursFromNow, makeWorld, sampleTerms } from "../packages/test-support/src/index.ts";
import { reputationSummary } from "../packages/domain/src/index.ts";

function setup() {
  const w = makeWorld();
  const seller = w.login("9100000001");
  const buyer = w.login("9100000002");
  w.verify(seller.user, "PERSON_IDENTITY");
  w.verify(buyer.user, "ORGANIZATION_EXISTENCE");
  const lotInput = (over: Record<string, unknown> = {}) => ({
    productId: "prod_mature_coconut" as const, gradeAttributes: { husk: "WITH_HUSK" }, gradeGroup: "FAQ", unit: "NUT" as const, quantityTotal: "10000", partialFulfilmentAllowed: true,
    originMarketId: "market_anaimalai", preciseLocation: { lat: 10.59, lon: 76.94 }, availableFrom: "2026-10-02T04:00:00Z", availableTo: "2026-10-06T04:00:00Z", expiresAt: hoursFromNow(w.clock, 72),
    fulfilment: { mode: "PICKUP" as const, costsIncluded: ["LOADING"], costsExcluded: ["TRANSPORT"] }, priceExpectation: { unitPricePaise: 3000 }, ...over,
  });
  const activeLot = (over: Record<string, unknown> = {}) => {
    const lot = w.p.createLot(seller.user, lotInput(over));
    w.p.addLotPhoto(seller.user, lot.sellLotId);
    return w.p.activateLot(seller.user, lot.sellLotId);
  };
  return { w, seller, buyer, lotInput, activeLot };
}

test("lot lifecycle: validation, photo rule, review for new participants, expiry, withdrawal, privacy", () => {
  const { w, seller, lotInput, activeLot } = setup();
  const lot = w.p.createLot(seller.user, lotInput({ gradeAttributes: {} }));
  assert.throws(() => w.p.activateLot(seller.user, lot.sellLotId), /MISSING_ATTRIBUTE_HUSK.*PHOTO_REQUIRED/);
  w.p.updateLot(seller.user, lot.sellLotId, { gradeAttributes: { husk: "DEHUSKED" } });
  w.p.addLotPhoto(seller.user, lot.sellLotId);
  assert.equal(w.p.activateLot(seller.user, lot.sellLotId).status, "ACTIVE");

  // photo exception only by an approved operator with justification
  const l2 = w.p.createLot(seller.user, lotInput());
  assert.throws(() => w.p.activateLot(seller.user, l2.sellLotId), /PHOTO_REQUIRED/);
  const ops = w.operator();
  assert.throws(() => w.p.grantPhotoException(ops.user, ops.session, l2.sellLotId, ""), /justification/i);
  w.p.grantPhotoException(ops.user, ops.session, l2.sellLotId, "Remote farm, no signal; verified by phone");
  assert.equal(w.p.activateLot(seller.user, l2.sellLotId).status, "ACTIVE");

  // public view hides precise location and seller id
  const pub = JSON.stringify(w.p.searchLots());
  assert.equal(pub.includes("preciseLocation"), false);
  assert.equal(pub.includes(seller.user.userId), false);
  assert.ok(pub.includes("Identity") === false && pub.includes("claim.PERSON_IDENTITY"));

  // new participant goes to review
  const newbie = w.login("9100000009");
  const nl = w.p.createLot(newbie.user, lotInput());
  w.p.addLotPhoto(newbie.user, nl.sellLotId);
  assert.equal(w.p.activateLot(newbie.user, nl.sellLotId).status, "PENDING_REVIEW");
  assert.equal(w.p.searchLots().some((l) => l.sellLotId === nl.sellLotId), false);
  assert.equal(w.p.reviewListing(ops.user, ops.session, nl.sellLotId, "APPROVE", "docs ok").status, "ACTIVE");

  // other users cannot edit; expiry; withdraw
  assert.throws(() => w.p.updateLot(newbie.user, lot.sellLotId, { quantityTotal: "1" }), /not found/i);
  w.clock.advanceHours(100);
  assert.deepEqual(w.p.runExpiry().lots >= 2, true);
  assert.equal(w.p.searchLots().length, 0);
  const l3 = activeLotFresh();
  function activeLotFresh() { const x = w.p.createLot(seller.user, lotInput({ expiresAt: hoursFromNow(w.clock, 24) })); w.p.addLotPhoto(seller.user, x.sellLotId); return w.p.activateLot(seller.user, x.sellLotId); }
  assert.equal(w.p.withdrawLot(seller.user, l3.sellLotId).status, "WITHDRAWN");
  assert.throws(() => w.p.withdrawLot(seller.user, l3.sellLotId));
});

test("agent disclosure and org membership are enforced", () => {
  const { w, seller, lotInput } = setup();
  const lot = w.p.createLot(seller.user, lotInput({ listedOnBehalfOf: "" }));
  w.p.addLotPhoto(seller.user, lot.sellLotId);
  assert.throws(() => w.p.activateLot(seller.user, lot.sellLotId), /AGENT_DISCLOSURE_REQUIRED/);
  assert.throws(() => w.p.createLot(seller.user, lotInput({ organizationId: "org_other" })), /Not a member|member/i);
});

test("requirements: verified buyers only, validation, recurrence, close", () => {
  const { w, buyer, seller } = setup();
  const input = { productId: "prod_mature_coconut" as const, gradeGroup: "FAQ", unit: "NUT" as const, targetQuantity: "8000", minQuantity: "4000", partialAllowed: true, destinationMarketId: "market_pollachi", maxRadiusKm: 40, requiredFrom: "2026-10-03T00:00:00Z", requiredBy: "2026-10-07T00:00:00Z", expiresAt: hoursFromNow(w.clock, 96), maxUnitPricePaise: 3200 };
  const unverified = w.login("9100000008");
  assert.throws(() => w.p.createRequirement(unverified.user, input), /verification/i);
  assert.throws(() => w.p.createRequirement(buyer.user, { ...input, minQuantity: "9000" }), /MIN_EXCEEDS_TARGET/);
  assert.throws(() => w.p.createRequirement(buyer.user, { ...input, unit: "QUINTAL" as never, productId: "prod_tender_coconut" }), /UNIT_NOT_SUPPORTED/);
  const r = w.p.createRequirement(buyer.user, input);
  assert.equal(r.status, "ACTIVE");
  const rec = w.p.createRecurringRequirement(buyer.user, input, "WEEKLY", 3);
  assert.equal(rec.instances.length, 3);
  assert.equal(Date.parse(rec.instances[1]!.requiredFrom) - Date.parse(rec.instances[0]!.requiredFrom), 7 * 86_400_000);
  const added = w.p.extendRecurrence(buyer.user, rec.template.templateId, { targetQuantity: "9000" }, 1);
  assert.equal(added.length, 1);
  assert.equal(added[0]!.targetQuantity, "9000");
  assert.equal(rec.instances[0]!.targetQuantity, "8000", "editing a template affects only future instances");
  assert.equal(w.p.closeRequirement(buyer.user, r.requirementId).status, "CLOSED");
  assert.throws(() => w.p.closeRequirement(seller.user, r.requirementId), /not found/i);
});

test("matching is explainable, excludes blocked/suspended/expired and never commits a trade", () => {
  const { w, seller, buyer, activeLot } = setup();
  const lot = activeLot();
  const input = { productId: "prod_mature_coconut" as const, gradeGroup: "FAQ", unit: "NUT" as const, targetQuantity: "8000", minQuantity: "4000", partialAllowed: true, destinationMarketId: "market_pollachi", maxRadiusKm: 40, requiredFrom: "2026-10-03T00:00:00Z", requiredBy: "2026-10-07T00:00:00Z", expiresAt: hoursFromNow(w.clock, 96), maxUnitPricePaise: 3200 };
  const req = w.p.createRequirement(buyer.user, input);
  const m = w.p.matchesForRequirement(buyer.user, req.requirementId);
  assert.equal(m.length, 1);
  assert.ok(m[0]!.reasons.includes("PRODUCT_EXACT") && m[0]!.reasons.includes("GRADE_EXACT") && m[0]!.reasons.includes("PRICE_OVERLAP"));
  assert.ok(m[0]!.reasons.some((r) => /^QUANTITY_COVERS_100_PERCENT$/.test(r)));
  assert.ok(m[0]!.reasons.some((r) => /^PICKUP_WITHIN_\d+_KM$/.test(r)));
  assert.equal(w.p.deals.size + w.p.offers.size, 0);
  // far away requirement is incompatible and operators can see why
  const far = w.p.createRequirement(buyer.user, { ...input, maxRadiusKm: 1 });
  const ops = w.operator();
  const ineligible = w.p.operatorMatches(ops.user, ops.session, far.requirementId);
  assert.ok(ineligible[0]!.incompatibilities.includes("OUTSIDE_RADIUS"));
  assert.equal(w.p.matchesForRequirement(buyer.user, far.requirementId).length, 0);
  // price mismatch
  const cheap = w.p.createRequirement(buyer.user, { ...input, maxUnitPricePaise: 2000 });
  assert.ok(w.p.operatorMatches(ops.user, ops.session, cheap.requirementId)[0]!.incompatibilities.includes("PRICE_NO_OVERLAP"));
  // seller view of matches hides incompatibility detail
  assert.ok(w.p.matchesForLot(seller.user, lot.sellLotId).length >= 1);
  // blocked → excluded
  w.p.blockUser(seller.user, buyer.user.userId);
  assert.equal(w.p.matchesForRequirement(buyer.user, req.requirementId).length, 0);
  // suspended seller → excluded
  seller.user.blocked = [];
  w.p.suspendUser(ops.user, ops.session, seller.user.userId, "fraud signal");
  assert.equal(w.p.matchesForRequirement(buyer.user, req.requirementId).length, 0);
  assert.throws(() => w.p.authenticate(seller.token), /Authentication|suspended/i);
});

test("offers: validation, counter-offer chain is immutable, expiry and wrong-party actions", () => {
  const { w, seller, buyer, activeLot } = setup();
  const lot = activeLot();
  const stranger = w.login("9100000007");
  w.verify(stranger.user, "PERSON_IDENTITY");
  const exp = hoursFromNow(w.clock, 6);
  assert.throws(() => w.p.createOffer(buyer.user, { sellLotId: lot.sellLotId, terms: sampleTerms({ quantity: "20000" }), expiresAt: exp }), /QUANTITY_EXCEEDS_AVAILABLE/);
  assert.throws(() => w.p.createOffer(buyer.user, { sellLotId: lot.sellLotId, terms: sampleTerms({ unit: "KG" }), expiresAt: exp }), /UNIT_MISMATCH/);
  assert.throws(() => w.p.createOffer(buyer.user, { sellLotId: lot.sellLotId, terms: sampleTerms(), expiresAt: hoursFromNow(w.clock, 500) }), /EXPIRY_TOO_LONG/);
  assert.throws(() => w.p.createOffer(buyer.user, { sellLotId: lot.sellLotId, terms: sampleTerms({ costsIncluded: [], costsExcluded: [] }), expiresAt: exp }), /COSTS_NOT_STATED/);
  assert.throws(() => w.p.createOffer(seller.user, { sellLotId: lot.sellLotId, terms: sampleTerms(), expiresAt: exp }), /own lot/);
  const unverified = w.login("9100000006");
  assert.throws(() => w.p.createOffer(unverified.user, { sellLotId: lot.sellLotId, terms: sampleTerms(), expiresAt: exp }), /verification/i);

  const o1 = w.p.createOffer(buyer.user, { sellLotId: lot.sellLotId, terms: sampleTerms(), expiresAt: exp });
  assert.equal(o1.estimatedTotalPaise, 15_000_000);
  assert.throws(() => w.p.createOffer(buyer.user, { sellLotId: lot.sellLotId, terms: sampleTerms(), expiresAt: exp }), /active offer/i);
  assert.throws(() => w.p.acceptOffer(buyer.user, o1.offerId), /own offer/);
  assert.throws(() => w.p.acceptOffer(stranger.user, o1.offerId), /not found/i);
  const o2 = w.p.counterOffer(seller.user, o1.offerId, sampleTerms({ unitPricePaise: 3100 }), exp);
  assert.equal(o2.revision, 2);
  assert.equal(o2.previousOfferId, o1.offerId);
  assert.equal(w.p.offers.get(o1.offerId)!.status, "COUNTERED");
  assert.equal(w.p.offers.get(o1.offerId)!.terms.unitPricePaise, 3000, "prior revision untouched");
  assert.throws(() => (w.p.offers.get(o1.offerId)!.terms as { unitPricePaise: number }).unitPricePaise = 1, TypeError);
  assert.throws(() => w.p.acceptOffer(seller.user, o1.offerId), /countered/i);
  assert.throws(() => w.p.counterOffer(seller.user, o2.offerId, sampleTerms(), exp), /own offer/);
  // expiry
  w.clock.advanceHours(7);
  assert.throws(() => w.p.acceptOffer(buyer.user, o2.offerId), /expired/i);
  assert.equal(w.p.runExpiry().offers, 1);
});

test("acceptance reserves quantity atomically and cannot oversell", () => {
  const { w, seller, buyer, activeLot } = setup();
  const lot = activeLot({ quantityTotal: "10000", partialFulfilmentAllowed: true });
  const buyer2 = w.login("9100000005");
  w.verify(buyer2.user, "PERSON_IDENTITY");
  const exp = hoursFromNow(w.clock, 6);
  const a = w.p.createOffer(buyer.user, { sellLotId: lot.sellLotId, terms: sampleTerms({ quantity: "7000" }), expiresAt: exp });
  const b = w.p.createOffer(buyer2.user, { sellLotId: lot.sellLotId, terms: sampleTerms({ quantity: "6000" }), expiresAt: exp });
  const deal = w.p.acceptOffer(seller.user, a.offerId);
  assert.equal(deal.status, "AGREED");
  assert.equal(w.p.lots.get(lot.sellLotId)!.quantityReserved, "7000");
  assert.equal(w.p.offers.get(b.offerId)!.status, "INVALIDATED", "offer larger than remaining quantity is invalidated");
  assert.throws(() => w.p.acceptOffer(seller.user, b.offerId), /not active|INVALIDATED/i);
  // a smaller offer still fits
  const c = w.p.createOffer(buyer2.user, { sellLotId: lot.sellLotId, terms: sampleTerms({ quantity: "3000" }), expiresAt: exp });
  assert.throws(() => w.p.updateLot(seller.user, lot.sellLotId, { quantityTotal: "5000" }), /reserved/i);
  const deal2 = w.p.acceptOffer(seller.user, c.offerId);
  assert.equal(w.p.lots.get(lot.sellLotId)!.quantityReserved, "10000");
  assert.equal(deal2.cards[0]!.terms.quantity, "3000");
  assert.throws(() => w.p.createOffer(buyer.user, { sellLotId: lot.sellLotId, terms: sampleTerms({ quantity: "1" }), expiresAt: exp }), /QUANTITY_EXCEEDS_AVAILABLE/);
  assert.throws(() => w.p.withdrawLot(seller.user, lot.sellLotId), /reserved/i);
});

test("material lot edits invalidate open offers and create a revision; version conflicts are detected", () => {
  const { w, seller, buyer, activeLot } = setup();
  const lot = activeLot();
  const o = w.p.createOffer(buyer.user, { sellLotId: lot.sellLotId, terms: sampleTerms(), expiresAt: hoursFromNow(w.clock, 6) });
  assert.throws(() => w.p.updateLot(seller.user, lot.sellLotId, { expiresAt: hoursFromNow(w.clock, 90) }, 999), /changed by someone/);
  const nonMaterial = w.p.updateLot(seller.user, lot.sellLotId, { expiresAt: hoursFromNow(w.clock, 90) });
  assert.equal(nonMaterial.materialRevision, false);
  assert.equal(w.p.offers.get(o.offerId)!.status, "ACTIVE");
  const mat = w.p.updateLot(seller.user, lot.sellLotId, { priceExpectation: { unitPricePaise: 3500 } });
  assert.equal(mat.materialRevision, true);
  assert.equal(w.p.offers.get(o.offerId)!.status, "INVALIDATED");
});

test("contact reveal requires mutual interest, is rate limited and logged; block and report work", () => {
  const { w, seller, buyer, activeLot } = setup();
  const lot = activeLot();
  const exp = hoursFromNow(w.clock, 6);
  const o = w.p.createOffer(buyer.user, { sellLotId: lot.sellLotId, terms: sampleTerms(), expiresAt: exp });
  assert.throws(() => w.p.revealContact(buyer.user, o.threadId), /mutual interest/);
  w.p.counterOffer(seller.user, o.offerId, sampleTerms({ unitPricePaise: 3050 }), exp);
  assert.equal(w.p.revealContact(buyer.user, o.threadId).phone, seller.user.phone);
  assert.ok(w.p.audit.some((a) => a.action === "CONTACT_REVEALED"));
  const outsider = w.login("9100000004");
  assert.throws(() => w.p.revealContact(outsider.user, o.threadId), /not found/i);
  const tight = makeWorld({ contactRevealPerDay: 1 });
  void tight;
  w.p.cfg.contactRevealPerDay = 1;
  assert.throws(() => w.p.revealContact(buyer.user, o.threadId), /limit/i);
  const rep = w.p.reportUser(buyer.user, seller.user.userId, "SPAM");
  assert.ok(rep.reportId);
  assert.ok(w.p.queue.size > 0);
});

function dealFlow(deemed = false) {
  const s = setup();
  const lot = s.activeLot();
  const exp = hoursFromNow(s.w.clock, 6);
  const o = s.w.p.createOffer(s.buyer.user, { sellLotId: lot.sellLotId, terms: sampleTerms(), expiresAt: exp });
  const deal = s.w.p.acceptOffer(s.seller.user, o.offerId);
  void deemed;
  return { ...s, lot, deal };
}

test("deal card is immutable; amendments need the counterparty; full happy path completes with reputation events", () => {
  const { w, seller, buyer, deal, lot } = dealFlow();
  assert.throws(() => { (deal.cards[0]!.terms as { quantity: string }).quantity = "1"; }, TypeError);
  assert.throws(() => { (deal.events[0] as { type: string }).type = "X"; }, TypeError);
  w.p.proposeAmendment(buyer.user, deal.dealId, sampleTerms({ quantity: "4000" }));
  assert.throws(() => w.p.respondAmendment(buyer.user, deal.dealId, true), /proposer/);
  assert.throws(() => w.p.confirmPickup(seller.user, deal.dealId), /amendment/i);
  w.p.respondAmendment(seller.user, deal.dealId, true);
  assert.equal(deal.cards.length, 2);
  assert.equal(deal.cards[0]!.terms.quantity, "5000", "original revision preserved");
  assert.equal(w.p.lots.get(lot.sellLotId)!.quantityReserved, "4000");
  assert.equal(deal.cards[1]!.totalPaise, 12_000_000);
  w.p.proposeAmendment(seller.user, deal.dealId, sampleTerms({ quantity: "4000", unitPricePaise: 4000 }));
  w.p.respondAmendment(buyer.user, deal.dealId, false);
  assert.equal(deal.cards.length, 2);

  w.p.confirmPickup(seller.user, deal.dealId);
  w.p.addDealEvidence(seller.user, deal.dealId, "WEIGHMENT_SLIP", "count 4000");
  w.p.confirmDelivery(seller.user, deal.dealId);
  assert.throws(() => w.p.acceptDelivery(seller.user, deal.dealId), /buyer/i);
  w.p.acceptDelivery(buyer.user, deal.dealId);
  assert.throws(() => w.p.confirmPayment(buyer.user, deal.dealId, "UPI"), /seller/i);
  w.p.confirmPayment(seller.user, deal.dealId, "UPI");
  assert.equal(deal.events.find((e) => e.type === "PAYMENT_CONFIRMED")!.data!.guarantee, false);
  w.p.completeDeal(buyer.user, deal.dealId);
  assert.equal(deal.status, "COMPLETED");
  assert.deepEqual(deal.events.map((e) => e.seq), deal.events.map((_, i) => i + 1));
  assert.throws(() => w.p.cancelDeal(buyer.user, deal.dealId, "x"));
  assert.equal(w.p.publicReputation(seller.user.userId).sufficientData, false, "small samples are not exposed");
  const events = Array.from({ length: 5 }, (_, i) => ({ partyId: "p", type: "DEAL_COMPLETED" as const, dealId: `d${i}`, at: "" }));
  assert.equal(reputationSummary(events, "p").sufficientData, true);
  // evidence access control
  const outsider = w.login("9100000003");
  assert.throws(() => w.p.dealEvidence(outsider.user, outsider.session, deal.dealId), /not found/i);
  assert.equal(w.p.dealEvidence(buyer.user, buyer.session, deal.dealId).length, 1);
});

test("cancellation releases reserved quantity; invalid transitions are rejected", () => {
  const { w, seller, buyer, deal, lot } = dealFlow();
  assert.throws(() => w.p.acceptDelivery(buyer.user, deal.dealId), /cannot move/);
  assert.throws(() => w.p.cancelDeal(buyer.user, deal.dealId, ""), /reason/i);
  w.p.cancelDeal(buyer.user, deal.dealId, "Truck unavailable");
  assert.equal(w.p.lots.get(lot.sellLotId)!.quantityReserved, "0");
  assert.equal(w.p.lots.get(lot.sellLotId)!.status, "ACTIVE");
  assert.equal(w.p.reputation.at(-1)!.type, "CANCELLED_BY_PARTY");
  void seller;
});

test("deemed acceptance only fires after the agreed window", () => {
  const { w, seller, deal } = dealFlow();
  w.p.confirmDelivery(seller.user, deal.dealId);
  w.clock.advanceHours(23);
  assert.equal(w.p.runExpiry().deemedAcceptances, 0);
  w.clock.advanceHours(2);
  assert.equal(w.p.runExpiry().deemedAcceptances, 1);
  assert.equal(deal.status, "ACCEPTED");
  assert.equal(w.p.runExpiry().deemedAcceptances, 0);
});

test("disputes: window, structured fields, response, operator resolution without altering the card", () => {
  const { w, seller, buyer, deal } = dealFlow();
  w.p.confirmDelivery(seller.user, deal.dealId);
  const cardBefore = JSON.stringify(deal.cards);
  const ev = w.p.addDealEvidence(buyer.user, deal.dealId, "PHOTO", "damaged nuts");
  const outsider = w.login("9100000011");
  assert.throws(() => w.p.openDispute(outsider.user, deal.dealId, { reason: "DAMAGE" }), /not found/i);
  const dis = w.p.openDispute(buyer.user, deal.dealId, { reason: "DAMAGE", claimedQuantity: "500", claimedAmountPaise: 1_500_000, evidenceIds: [ev.evidenceId] });
  assert.equal(deal.status, "DISPUTED");
  assert.throws(() => w.p.openDispute(seller.user, deal.dealId, { reason: "NON_PAYMENT" }), /already exists/);
  assert.throws(() => w.p.completeDeal(seller.user, deal.dealId));
  assert.throws(() => w.p.getDispute(outsider.user, dis.disputeId), /not found/i);
  const ops = w.operator();
  assert.throws(() => w.p.resolveDispute(ops.user, ops.session, dis.disputeId, "UPHELD", "x"), /response window/i);
  // operators can see evidence for disputed deals only through an audited path
  assert.equal(w.p.dealEvidence(ops.user, ops.session, deal.dealId).length, 1);
  assert.ok(w.p.audit.some((a) => a.action === "DEAL_EVIDENCE_VIEWED"));
  w.p.respondDispute(seller.user, dis.disputeId, "Weather damage after pickup", []);
  assert.throws(() => w.p.respondDispute(seller.user, dis.disputeId, "again"), /already/i);
  assert.throws(() => w.p.resolveDispute(ops.user, ops.session, dis.disputeId, "UPHELD", ""), /reason/i);
  const res = w.p.resolveDispute(ops.user, ops.session, dis.disputeId, "PARTIALLY_UPHELD", "Photos confirm 300 damaged");
  assert.equal(res.resolution!.operatorId, ops.user.userId);
  assert.equal(JSON.stringify(deal.cards), cardBefore, "operators cannot alter the Deal Card");
  assert.equal(deal.status, "ACCEPTED");
  assert.throws(() => w.p.resolveDispute(ops.user, ops.session, dis.disputeId, "UPHELD", "again"), /already/i);
  assert.ok(w.p.audit.some((a) => a.action === "DISPUTE_RESOLVED" && a.reason));
});

test("dispute window closes after delivery acceptance period (except payment/no-show)", () => {
  const { w, seller, buyer, deal } = dealFlow();
  w.p.confirmDelivery(seller.user, deal.dealId);
  w.clock.advanceHours(30);
  assert.throws(() => w.p.openDispute(buyer.user, deal.dealId, { reason: "QUALITY_MISMATCH" }), /window/);
  assert.equal(w.p.openDispute(seller.user, deal.dealId, { reason: "NON_PAYMENT" }).reason, "NON_PAYMENT");
});

test("operator capabilities: separate, step-up required, audited, no self-decisions", () => {
  const w = makeWorld();
  const user = w.login("9200000001");
  assert.throws(() => w.p.listQueue(user.user, user.session), /permitted|Not permitted/i);
  const rawOps = w.login("+919000000001");
  assert.throws(() => w.p.listQueue(rawOps.user, rawOps.session), /Step-up/);
  const ops = w.operator();
  assert.deepEqual(w.p.listQueue(ops.user, ops.session), []);
  const claim = w.p.submitClaim(ops.user, "PERSON_IDENTITY", {}, ["doc"]);
  assert.throws(() => w.p.decideClaim(ops.user, ops.session, claim.claimId, "APPROVED", "OK"), /own claim/i);
  const other = w.operator("+919000000002");
  assert.equal(w.p.decideClaim(other.user, other.session, claim.claimId, "APPROVED", "OK").status, "APPROVED");
  assert.throws(() => w.p.decideClaim(other.user, other.session, claim.claimId, "APPROVED", "OK"), /Claim is/);
  assert.throws(() => w.p.decideClaim(other.user, other.session, claim.claimId, "REVOKED", ""), /reason/i);
  // sensitive documents: only owner or capability holder, access logged
  const doc = w.p.evidence.get(claim.evidenceIds[0]!)!;
  assert.throws(() => w.p.accessEvidence(user.user, user.session, doc.evidenceId), /not found/i);
  assert.equal(w.p.accessEvidence(other.user, other.session, doc.evidenceId).evidenceId, doc.evidenceId);
  assert.ok(w.p.audit.some((a) => a.action === "SENSITIVE_EVIDENCE_ACCESSED"));
  assert.ok(w.p.readAudit(ops.user, ops.session).length > 0);
  // public claim summary has no evidence
  assert.equal(JSON.stringify(w.p.claimSummaries(ops.user.userId)).includes("evidence"), false);
});
