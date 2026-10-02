import test from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { hoursFromNow, makeWorld, sampleTerms } from "../packages/test-support/src/index.ts";
import { apportion } from "../apps/api/src/fulfilment.ts";
import { createApp } from "../apps/api/src/server.ts";

const png = () => Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82]);

function dealWorld() {
  const w = makeWorld();
  const seller = w.login("9700000001"), buyer = w.login("9700000002");
  w.verify(seller.user, "PERSON_IDENTITY"); w.verify(buyer.user, "PERSON_IDENTITY");
  const lot = w.p.createLot(seller.user, { productId: "prod_mature_coconut", gradeAttributes: { husk: "WITH_HUSK" }, gradeGroup: "FAQ", unit: "NUT", quantityTotal: "10000", partialFulfilmentAllowed: true, originMarketId: "market_pollachi", availableFrom: "2026-10-02T04:00:00Z", availableTo: "2026-10-09T04:00:00Z", expiresAt: hoursFromNow(w.clock, 200), fulfilment: { mode: "PICKUP", costsIncluded: ["LOADING"], costsExcluded: [] }, priceExpectation: { unitPricePaise: 3000 }, photoCount: 1 });
  w.p.activateLot(seller.user, lot.sellLotId);
  const offer = w.p.createOffer(buyer.user, { sellLotId: lot.sellLotId, terms: sampleTerms({ quantity: "6000" }), expiresAt: hoursFromNow(w.clock, 6) });
  const deal = w.p.acceptOffer(seller.user, offer.offerId);
  return { w, seller, buyer, lot, deal };
}
function partnerOrg(w: ReturnType<typeof makeWorld>, phone: string, kind: "INSPECTION_PARTNER" | "LOGISTICS_PARTNER", markets = ["market_pollachi"]) {
  const u = w.login(phone);
  const org = w.p.createOrganization(u.user, `${kind} ${phone}`, kind);
  const pt = w.p.fx.applyPartner(u.user, org.organizationId, markets);
  const ops = w.operator();
  w.p.fx.decidePartner(ops.user, ops.session, pt.partnerId, "APPROVED", "Documents checked");
  return { ...u, partner: pt };
}

test("apportion distributes exactly and deterministically", () => {
  const w = [{ id: "a", weight: 1n }, { id: "b", weight: 1n }, { id: "c", weight: 1n }];
  const r = apportion(100, w);
  assert.equal([...r.values()].reduce((a, b) => a + b, 0), 100);
  assert.deepEqual([...apportion(100, w).entries()], [...r.entries()]);
  assert.throws(() => apportion(5, [{ id: "a", weight: 0n }]));
});

test("partners must be approved by an operator before acting", () => {
  const { w } = dealWorld();
  const u = w.login("9700000010");
  const trader = w.p.createOrganization(u.user, "Trader", "TRADER");
  assert.throws(() => w.p.fx.applyPartner(u.user, trader.organizationId, []), /INSPECTION_PARTNER/);
  const org = w.p.createOrganization(u.user, "Inspect Co", "INSPECTION_PARTNER");
  const pt = w.p.fx.applyPartner(u.user, org.organizationId, ["market_pollachi"]);
  assert.throws(() => w.p.fx.applyPartner(u.user, org.organizationId, []), /Already/);
  assert.equal(w.p.fx.listPartners().length, 0);
  assert.throws(() => w.p.fx.acceptInspection(u.user, "insp_x"), /not found/i);
  const ops = w.operator();
  assert.throws(() => w.p.fx.decidePartner(ops.user, ops.session, pt.partnerId, "APPROVED", ""), /reason/i);
  w.p.fx.decidePartner(ops.user, ops.session, pt.partnerId, "APPROVED", "ok");
  assert.equal(w.p.fx.listPartners("INSPECTION").length, 1);
  assert.equal(w.p.fx.listPartners("LOGISTICS").length, 0);
});

test("inspection workflow gates the deal; PASS proceeds, FAIL needs the buyer's decision; SLA is measurable", () => {
  const { w, seller, buyer, deal } = dealWorld();
  const insp = partnerOrg(w, "9700000011", "INSPECTION_PARTNER");
  const stranger = w.login("9700000012");
  assert.throws(() => w.p.fx.requestInspection(stranger.user, deal.dealId, { partnerId: insp.partner.partnerId, scheduledAt: hoursFromNow(w.clock, 5), location: "Farm" }), /not found/i);
  assert.throws(() => w.p.fx.requestInspection(buyer.user, deal.dealId, { partnerId: "nope", scheduledAt: hoursFromNow(w.clock, 5), location: "Farm" }), /partner/i);
  assert.throws(() => w.p.fx.requestInspection(buyer.user, deal.dealId, { partnerId: insp.partner.partnerId, scheduledAt: hoursFromNow(w.clock, -5), location: "Farm" }), /future/);
  const i = w.p.fx.requestInspection(buyer.user, deal.dealId, { partnerId: insp.partner.partnerId, scheduledAt: hoursFromNow(w.clock, 5), location: "Farm" });
  assert.equal(deal.status, "INSPECTION_PENDING");
  assert.throws(() => w.p.confirmPickup(seller.user, deal.dealId), /cannot move/);
  assert.throws(() => w.p.fx.requestInspection(buyer.user, deal.dealId, { partnerId: insp.partner.partnerId, scheduledAt: hoursFromNow(w.clock, 5), location: "x" }), /agreed deal/);
  assert.throws(() => w.p.fx.acceptInspection(buyer.user, i.inspectionId), /partner membership/i);
  w.clock.advanceHours(1);
  w.p.fx.acceptInspection(insp.user, i.inspectionId);
  assert.throws(() => w.p.fx.submitInspectionResult(insp.user, i.inspectionId, { outcome: "MAYBE" as never, measurements: {}, note: "" }), /Outcome/);
  w.clock.advanceHours(5);
  w.p.fx.submitInspectionResult(insp.user, i.inspectionId, { outcome: "PASS", measurements: { sampleSize: 100, defectPercent: 1.5 }, note: "Good" });
  assert.equal(deal.status, "AGREED");
  assert.equal(w.p.fx.inspections.get(i.inspectionId)!.status, "DECIDED");
  assert.ok(w.p.evidence.size > 0 && [...w.p.evidence.values()].some((e) => e.kind === "INSPECTION_RESULT" && e.visibleTo.includes(seller.user.userId)));
  const sla = w.p.fx.partnerSla(insp.partner.partnerId);
  assert.equal(sla.inspections.total, 1);
  assert.equal(sla.inspections.avgHoursToAccept, 1);
  assert.equal(sla.inspections.avgHoursToComplete, 6);
  assert.equal(sla.inspections.onTimeRatePercent, 100);

  // FAIL path: buyer rejects → deal cancelled and quantity released
  const lotId = deal.sellLotId;
  const i2 = w.p.fx.requestInspection(seller.user, deal.dealId, { partnerId: insp.partner.partnerId, scheduledAt: hoursFromNow(w.clock, 5), location: "Farm" });
  w.p.fx.acceptInspection(insp.user, i2.inspectionId);
  w.p.fx.submitInspectionResult(insp.user, i2.inspectionId, { outcome: "FAIL", measurements: { moisturePercent: 12 }, note: "Wet" });
  assert.equal(deal.status, "INSPECTION_PENDING");
  assert.throws(() => w.p.fx.decideInspection(seller.user, i2.inspectionId, true), /buyer decides/);
  w.p.fx.decideInspection(buyer.user, i2.inspectionId, false);
  assert.equal(deal.status, "CANCELLED");
  assert.equal(w.p.lots.get(lotId)!.quantityReserved, "0");
  assert.throws(() => (w.p.fx.inspections.get(i.inspectionId)!.status = "DECIDED") && w.p.fx.decideInspection(buyer.user, i.inspectionId, true), /Inspection is DECIDED/);
});

test("logistics: partner quotes, party books exactly one, statuses are ordered, details are protected", () => {
  const { w, seller, buyer, deal } = dealWorld();
  const t1 = partnerOrg(w, "9700000021", "LOGISTICS_PARTNER", ["market_pollachi"]);
  const t2 = partnerOrg(w, "9700000022", "LOGISTICS_PARTNER", ["market_pollachi"]);
  const far = partnerOrg(w, "9700000023", "LOGISTICS_PARTNER", ["market_sulur"]);
  const req = w.p.fx.requestTransport(buyer.user, deal.dealId, { destinationMarketId: "market_sulur", weightKg: 6000, windowFrom: hoursFromNow(w.clock, 10), windowTo: hoursFromNow(w.clock, 30) });
  assert.equal(w.p.fx.openTransportRequests(t1.user).length, 1);
  assert.equal(w.p.fx.openTransportRequests(far.user).length, 0, "only partners serving the pickup area see the request");
  const q = (price: number) => ({ pricePaise: price, vehicleType: "LCV", etaFrom: hoursFromNow(w.clock, 12), etaTo: hoursFromNow(w.clock, 20), validUntil: hoursFromNow(w.clock, 8) });
  assert.throws(() => w.p.fx.submitTransportQuote(far.user, req.requestId, q(100)), /service area/);
  assert.throws(() => w.p.fx.submitTransportQuote(t1.user, req.requestId, q(0)), /positive/);
  const q1 = w.p.fx.submitTransportQuote(t1.user, req.requestId, q(500000));
  const q2 = w.p.fx.submitTransportQuote(t2.user, req.requestId, q(450000));
  assert.throws(() => w.p.fx.submitTransportQuote(t1.user, req.requestId, q(400000)), /existing quote/);
  assert.deepEqual(w.p.fx.listTransportQuotes(seller.user, req.requestId).map((x) => x.pricePaise), [450000, 500000], "cheapest first");
  assert.throws(() => w.p.fx.listTransportQuotes(w.login("9700000024").user, req.requestId), /not found/i);
  assert.equal(w.p.fx.getTransport(buyer.user, req.requestId).vehicle, undefined);
  const booked = w.p.fx.bookTransport(seller.user, q2.quoteId, { registration: "TN37AB1234", driverPhone: "+919800000000" });
  assert.equal(booked.partnerId, t2.partner.partnerId);
  assert.equal(w.p.fx.transportQuotes.get(q1.quoteId)!.status, "REJECTED");
  assert.throws(() => w.p.fx.bookTransport(buyer.user, q1.quoteId, { registration: "x", driverPhone: "y" }), /Request is BOOKED|no longer valid/);
  assert.equal(w.p.fx.getTransport(buyer.user, req.requestId).vehicle!.registration, "TN37AB1234");
  assert.throws(() => w.p.fx.getTransport(t1.user, req.requestId), /not found/i, "losing partner cannot see vehicle details");
  assert.throws(() => w.p.fx.updateTransport(t1.user, req.requestId, "PICKED_UP"), /not found/i);
  assert.throws(() => w.p.fx.updateTransport(t2.user, req.requestId, "DELIVERED"), /cannot move/);
  w.p.fx.updateTransport(t2.user, req.requestId, "PICKED_UP");
  w.p.fx.updateTransport(t2.user, req.requestId, "IN_TRANSIT");
  w.clock.advanceHours(15);
  w.p.fx.updateTransport(t2.user, req.requestId, "DELIVERED");
  const sla = w.p.fx.partnerSla(t2.partner.partnerId).transport;
  assert.deepEqual([sla.quotesSubmitted, sla.booked, sla.delivered, sla.onTimeRatePercent], [1, 1, 1, 100]);
  assert.ok(deal.events.some((e) => e.type === "TRANSPORT_BOOKED"));
});

function fpoWorld() {
  const w = makeWorld();
  const mgr = w.login("9710000001"), fin = w.login("9710000002"), buyer = w.login("9710000003");
  w.verify(mgr.user, "ORGANIZATION_EXISTENCE"); w.verify(buyer.user, "PERSON_IDENTITY");
  const org = w.p.createOrganization(mgr.user, "Anaimalai FPO", "FPO");
  w.p.addMember(mgr.user, org.organizationId, fin.user.userId, "MEMBER");
  const add = (name: string, qty: string, over: Record<string, unknown> = {}) => w.p.fx.addMemberLot(mgr.user, org.organizationId, { memberName: name, productId: "prod_mature_coconut", gradeGroup: "FAQ", unit: "NUT", quantity: qty, originMarketId: "market_anaimalai", quality: { husk: "WITH_HUSK" }, ...over });
  return { w, mgr, fin, buyer, org, add };
}

test("FPO aggregation keeps member ownership and rejects incompatible lots", () => {
  const { w, mgr, fin, org, add } = fpoWorld();
  const a = add("Ravi", "3000"), b = add("Meena", "5000"), c = add("Kumar", "2000"), d = add("Bad Grade", "1000", { gradeGroup: "PREMIUM" });
  assert.throws(() => add("", "10"), /Member name/);
  assert.throws(() => add("X", "0"), /positive/);
  assert.throws(() => w.p.fx.reviewMemberLot(mgr.user, a.memberLotId, true), /different manager/);
  assert.throws(() => w.p.fx.addMemberLot(w.login("9710000009").user, org.organizationId, { memberName: "x", productId: "prod_mature_coconut", gradeGroup: "FAQ", unit: "NUT", quantity: "1", originMarketId: "market_pollachi" }), /Not permitted/);
  const input = (ids: string[]) => ({ memberLotIds: ids, availableFrom: "2026-10-02T04:00:00Z", availableTo: "2026-10-09T04:00:00Z", expiresAt: hoursFromNow(w.clock, 100), fulfilment: { mode: "PICKUP" as const, costsIncluded: ["LOADING"], costsExcluded: [] }, priceExpectation: { inviteOffers: true as const } });
  assert.throws(() => w.p.fx.buildAggregate(mgr.user, org.organizationId, input([a.memberLotId])), /NOT_APPROVED/);
  // second manager reviews (fin is a MEMBER → cannot review); promote fin to VERIFIER with step-up
  mgr.session.stepUpUntil = Date.now() + 1e9;
  w.p.addMember(mgr.user, org.organizationId, fin.user.userId, "VERIFIER", mgr.session);
  for (const l of [a, b, c, d]) w.p.fx.reviewMemberLot(fin.user, l.memberLotId, true);
  assert.throws(() => w.p.fx.buildAggregate(mgr.user, org.organizationId, input([a.memberLotId, d.memberLotId])), /GRADE_MISMATCH/);
  assert.throws(() => w.p.fx.buildAggregate(mgr.user, org.organizationId, input([])), /at least one/);
  const { aggregate, sellLot } = w.p.fx.buildAggregate(mgr.user, org.organizationId, input([a.memberLotId, b.memberLotId, c.memberLotId]));
  assert.equal(sellLot.quantityTotal, "10000");
  assert.equal(sellLot.organizationId, org.organizationId);
  assert.deepEqual(aggregate.contributions.map((x) => [x.memberName, x.quantity]), [["Ravi", "3000"], ["Meena", "5000"], ["Kumar", "2000"]]);
  assert.equal(w.p.fx.memberLots.get(a.memberLotId)!.status, "AGGREGATED");
  assert.throws(() => w.p.fx.buildAggregate(mgr.user, org.organizationId, input([a.memberLotId])), /NOT_APPROVED\(AGGREGATED\)/);
});

test("settlement splits payable exactly by contribution, honors deductions, needs approval, exports safely", () => {
  const { w, mgr, fin, buyer, org, add } = fpoWorld();
  mgr.session.stepUpUntil = Date.now() + 1e9;
  w.p.addMember(mgr.user, org.organizationId, fin.user.userId, "FINANCE", mgr.session);
  const lots = [add("Ravi", "3333"), add("=cmd|' /C calc'!A0", "3333"), add("Kumar", "3334")];
  w.p.addMember(mgr.user, org.organizationId, fin.user.userId, "VERIFIER", mgr.session);
  for (const l of lots) w.p.fx.reviewMemberLot(fin.user, l.memberLotId, true);
  w.p.addMember(mgr.user, org.organizationId, fin.user.userId, "FINANCE", mgr.session);
  const { sellLot } = w.p.fx.buildAggregate(mgr.user, org.organizationId, { memberLotIds: lots.map((l) => l.memberLotId), availableFrom: "2026-10-02T04:00:00Z", availableTo: "2026-10-09T04:00:00Z", expiresAt: hoursFromNow(w.clock, 100), fulfilment: { mode: "PICKUP", costsIncluded: ["LOADING"], costsExcluded: [] }, priceExpectation: { inviteOffers: true } });
  w.p.addLotPhoto(mgr.user, sellLot.sellLotId);
  w.p.activateLot(mgr.user, sellLot.sellLotId);
  const offer = w.p.createOffer(buyer.user, { sellLotId: sellLot.sellLotId, terms: sampleTerms({ quantity: "10000", unitPricePaise: 3333 }), expiresAt: hoursFromNow(w.clock, 6) });
  const deal = w.p.acceptOffer(mgr.user, offer.offerId);
  assert.throws(() => w.p.fx.draftSettlement(mgr.user, deal.dealId), /settle after/);
  w.p.confirmDelivery(mgr.user, deal.dealId, "9990");
  w.p.acceptDelivery(buyer.user, deal.dealId);
  assert.throws(() => w.p.fx.draftSettlement(buyer.user, deal.dealId), /Not permitted/);
  assert.throws(() => w.p.fx.draftSettlement(mgr.user, deal.dealId, [{ type: "TRANSPORT", amountPaise: 99_999_999_999 }]), /exceed/);
  const s = w.p.fx.draftSettlement(mgr.user, deal.dealId, [{ type: "TRANSPORT", amountPaise: 100_001 }, { type: "COMMISSION", amountPaise: 50_000 }]);
  assert.equal(s.acceptedQuantity, "9990", "settles on what was actually delivered");
  assert.equal(s.grossPaise, 9990 * 3333);
  assert.equal(s.lines.reduce((a, l) => a + l.grossPaise, 0), s.grossPaise);
  assert.equal(s.lines.reduce((a, l) => a + l.deductionPaise, 0), 150_001);
  assert.equal(s.lines.reduce((a, l) => a + l.netPaise, 0), s.netPaise);
  assert.equal(s.netPaise, s.grossPaise - 150_001);
  assert.equal(s.lines.reduce((a, l) => a + Number(l.quantity), 0), 9990);
  assert.throws(() => w.p.fx.draftSettlement(mgr.user, deal.dealId), /already exists/);
  assert.throws(() => w.p.fx.exportSettlementCsv(mgr.user, s.settlementId), /approved/);
  assert.throws(() => w.p.fx.approveSettlement(mgr.user, s.settlementId), /second manager/);
  w.p.fx.approveSettlement(fin.user, s.settlementId);
  assert.throws(() => w.p.fx.approveSettlement(fin.user, s.settlementId), /Settlement is APPROVED/);
  const csv = w.p.fx.exportSettlementCsv(fin.user, s.settlementId);
  assert.match(csv, /^settlementId,dealId,member/);
  assert.equal(csv.trim().split("\n").length, 5);
  assert.match(csv, /'=cmd/, "spreadsheet formula injection is neutralised");
  assert.ok(w.p.audit.some((a) => a.action === "SETTLEMENT_EXPORTED"));
});

test("media: signed upload, content sniffing, no serving before approval, attaches photos", async () => {
  const { w, seller, buyer, deal, lot } = dealWorld();
  const fx = w.p.fx;
  fx.baseUrl = "http://localhost:4000";
  await assert.rejects(async () => fx.createUploadIntent(seller.user, { purpose: "LOT_PHOTO", contentType: "application/x-msdownload", sizeBytes: 10, refId: lot.sellLotId }), /Allowed types/);
  assert.throws(() => fx.createUploadIntent(seller.user, { purpose: "LOT_PHOTO", contentType: "image/png", sizeBytes: 99_000_000, refId: lot.sellLotId }), /Size/);
  assert.throws(() => fx.createUploadIntent(buyer.user, { purpose: "LOT_PHOTO", contentType: "image/png", sizeBytes: 100, refId: lot.sellLotId }), /not found/i);
  const intent = fx.createUploadIntent(seller.user, { purpose: "LOT_PHOTO", contentType: "image/png", sizeBytes: 100, refId: lot.sellLotId });
  const u = new URL(intent.uploadUrl);
  const [exp, sig] = [Number(u.searchParams.get("exp")), u.searchParams.get("sig")!];
  await assert.rejects(() => fx.receiveUpload(intent.mediaId, exp, "bad-signature", png()), /invalid or expired/);
  await assert.rejects(() => fx.receiveUpload(intent.mediaId, exp, sig, new Uint8Array(500)), /size/i);
  await fx.receiveUpload(intent.mediaId, exp, sig, png());
  await assert.rejects(() => fx.receiveUpload(intent.mediaId, exp, sig, png()), /already/i);
  const before = w.p.lots.get(lot.sellLotId)!.photoCount;
  await assert.rejects(() => fx.readMedia(buyer.user, intent.mediaId), /not found/i);
  assert.equal((await fx.readMedia(seller.user, intent.mediaId)).bytes.length, 16, "owner can see their own pending file");
  assert.equal((await fx.scanMedia(intent.mediaId)).status, "APPROVED");
  assert.equal(w.p.lots.get(lot.sellLotId)!.photoCount, before + 1);
  assert.equal((await fx.readMedia(buyer.user, intent.mediaId)).media.status, "APPROVED");

  // content that lies about its type is rejected and deleted
  const bad = fx.createUploadIntent(seller.user, { purpose: "LOT_PHOTO", contentType: "image/png", sizeBytes: 64, refId: lot.sellLotId });
  const bu = new URL(bad.uploadUrl);
  await fx.receiveUpload(bad.mediaId, Number(bu.searchParams.get("exp")), bu.searchParams.get("sig")!, new TextEncoder().encode("<script>alert(1)</script>"));
  const rejected = await fx.scanMedia(bad.mediaId);
  assert.deepEqual([rejected.status, rejected.rejectionReason], ["REJECTED", "CONTENT_TYPE_MISMATCH"]);
  await assert.rejects(() => fx.readMedia(buyer.user, bad.mediaId), /not found/i);
  assert.equal(await fx.blobs.get(`private/${bad.mediaId}`), undefined);

  // deal evidence is limited to the parties
  const ev = fx.createUploadIntent(buyer.user, { purpose: "DEAL_EVIDENCE", contentType: "application/pdf", sizeBytes: 64, refId: deal.dealId });
  const eu = new URL(ev.uploadUrl);
  await fx.receiveUpload(ev.mediaId, Number(eu.searchParams.get("exp")), eu.searchParams.get("sig")!, new TextEncoder().encode("%PDF-1.4\n1 0 obj<< /Type /Catalog >>endobj"));
  assert.equal((await fx.scanMedia(ev.mediaId)).status, "APPROVED");
  assert.equal((await fx.readMedia(seller.user, ev.mediaId)).media.mediaId, ev.mediaId);
  await assert.rejects(() => fx.readMedia(w.login("9700000030").user, ev.mediaId), /not found/i);
  // active PDF content rejected
  const js = fx.createUploadIntent(buyer.user, { purpose: "DEAL_EVIDENCE", contentType: "application/pdf", sizeBytes: 100, refId: deal.dealId });
  const ju = new URL(js.uploadUrl);
  await fx.receiveUpload(js.mediaId, Number(ju.searchParams.get("exp")), ju.searchParams.get("sig")!, new TextEncoder().encode("%PDF-1.4 /JavaScript (app.alert(1))"));
  assert.equal((await fx.scanMedia(js.mediaId)).rejectionReason, "ACTIVE_CONTENT");
  // abandoned slots are purged
  const abandoned = fx.createUploadIntent(seller.user, { purpose: "LOT_PHOTO", contentType: "image/png", sizeBytes: 10, refId: lot.sellLotId });
  w.clock.advanceHours(1);
  assert.equal(await fx.purgeExpiredUploads(), 1);
  assert.equal(fx.media.has(abandoned.mediaId), false);
  await assert.rejects(() => fx.receiveUpload(abandoned.mediaId, Number(new URL(abandoned.uploadUrl).searchParams.get("exp")), new URL(abandoned.uploadUrl).searchParams.get("sig")!, png()), /invalid or expired/);
});

test("HTTP: direct upload with signed URL, authorised download and release D endpoints", async () => {
  const { w, seller, buyer, lot } = dealWorld();
  const srv = await createApp({ platform: w.p, internalToken: "tok" });
  await new Promise<void>((r) => srv.listen(0, r));
  const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  const h = { authorization: `Bearer ${seller.token}`, "content-type": "application/json" };
  try {
    const intent = await (await fetch(`${base}/v1/uploads/intents`, { method: "POST", headers: { ...h, "idempotency-key": "u1" }, body: JSON.stringify({ purpose: "LOT_PHOTO", contentType: "image/png", sizeBytes: 100, refId: lot.sellLotId }) })).json() as any;
    assert.ok(intent.uploadUrl);
    w.p.fx.baseUrl = base;
    const put = await fetch(intent.uploadUrl.startsWith("http") ? intent.uploadUrl : base + intent.uploadUrl, { method: "PUT", body: png() });
    assert.equal(put.status, 200);
    assert.equal((await fetch(`${base}/v1/uploads/${intent.mediaId}?exp=1&sig=x`, { method: "PUT", body: png() })).status, 403);
    const tick = await (await fetch(`${base}/v1/internal/tick`, { method: "POST", headers: { "x-internal-token": "tok" }, body: "{}" })).json() as any;
    assert.equal(tick.mediaScanned, 1);
    const dl = await fetch(`${base}/v1/media/${intent.mediaId}`, { headers: { authorization: `Bearer ${buyer.token}` } });
    assert.equal(dl.status, 200);
    assert.equal(dl.headers.get("content-type"), "image/png");
    assert.match(dl.headers.get("content-security-policy") ?? "", /sandbox/);
    assert.equal((await fetch(`${base}/v1/media/${intent.mediaId}`)).status, 401);
    assert.equal((await fetch(`${base}/v1/media/${intent.mediaId}`, { headers: { authorization: `Bearer ${w.login("9700000040").token}` } })).status, 200, "approved lot photos are part of the public lot view");
    const part = await fetch(`${base}/v1/partners?kind=INSPECTION`, { headers: h });
    assert.deepEqual((await part.json() as any).items, []);
  } finally { srv.close(); }
});

test("retention purge removes stale security state", () => {
  const w = makeWorld();
  w.login("9700000050");
  w.p.requestOtp("9700000051", "x");
  w.clock.advanceHours(3);
  const r = w.p.purgeStaleSecurityState();
  assert.ok(r.otpsPurged >= 1 && r.rateWindowsPurged >= 1);
  assert.equal(w.p.users.size, 1, "accounts are untouched");
});
