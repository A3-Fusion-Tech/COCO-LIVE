import test from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Deal, SellLot } from "@livecoco/domain";
import { createApp, type User } from "@livecoco/api";
import { hoursFromNow, makeWorld, sampleTerms, type Login, type World } from "@livecoco/test-support";
import { apportion } from "../apps/api/src/modules/fulfilment/fpo.service.ts";
import type { Inspection, MemberLot, TransportQuote } from "../apps/api/src/modules/fulfilment/fulfilment.types.ts";
import { MemoryBlobStore, type Media } from "../apps/api/src/modules/media/media.service.ts";

const png = () => Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82]);

const dealOf = async (w: World, dealId: string) => (await w.get<Deal>("deals", dealId))!;

/** Fresh step-up for an ordinary participant (high-risk membership changes). */
async function stepUp(w: World, who: Login) {
  await w.sys.identity.requestOtp(who.user.phone, "stepup" + who.user.phone);
  await w.as(who).identity.stepUp(w.otps.get(who.user.phone) as string);
}

async function dealWorld(extra: Parameters<typeof makeWorld>[0] = {}) {
  const w = makeWorld(extra);
  const seller = await w.login("9700000001"), buyer = await w.login("9700000002");
  await w.verify(seller, "PERSON_IDENTITY"); await w.verify(buyer, "PERSON_IDENTITY");
  const lot = await w.as(seller).lots.create({ productId: "prod_mature_coconut", gradeAttributes: { husk: "WITH_HUSK" }, gradeGroup: "FAQ", unit: "NUT", quantityTotal: "10000", partialFulfilmentAllowed: true, originMarketId: "market_pollachi", availableFrom: "2026-10-02T04:00:00Z", availableTo: "2026-10-09T04:00:00Z", expiresAt: hoursFromNow(w.clock, 200), fulfilment: { mode: "PICKUP", costsIncluded: ["LOADING"], costsExcluded: [] }, priceExpectation: { unitPricePaise: 3000 }, photoCount: 1 });
  await w.as(seller).lots.activate(lot.sellLotId);
  const offer = await w.as(buyer).offers.create({ sellLotId: lot.sellLotId, terms: sampleTerms({ quantity: "6000" }), expiresAt: hoursFromNow(w.clock, 6) });
  const deal = await w.as(seller).offers.accept(offer.offerId);
  return { w, seller, buyer, lot, deal };
}
async function partnerOrg(w: World, phone: string, kind: "INSPECTION_PARTNER" | "LOGISTICS_PARTNER", markets = ["market_pollachi"]) {
  const u = await w.login(phone);
  const org = await w.as(u).identity.createOrganization(`${kind} ${phone}`, kind);
  const pt = await w.as(u).partners.apply(org.organizationId, markets);
  const ops = await w.operator();
  await w.as(ops).partners.decide(pt.partnerId, "APPROVED", "Documents checked");
  return { ...u, partner: pt };
}

test("apportion distributes exactly and deterministically", () => {
  const w = [{ id: "a", weight: 1n }, { id: "b", weight: 1n }, { id: "c", weight: 1n }];
  const r = apportion(100, w);
  assert.equal([...r.values()].reduce((a, b) => a + b, 0), 100);
  assert.deepEqual([...apportion(100, w).entries()], [...r.entries()]);
  assert.throws(() => apportion(5, [{ id: "a", weight: 0n }]));
});

test("partners must be approved by an operator before acting", async () => {
  const { w } = await dealWorld();
  const u = await w.login("9700000010");
  const trader = await w.as(u).identity.createOrganization("Trader", "TRADER");
  await assert.rejects(w.as(u).partners.apply(trader.organizationId, []), /INSPECTION_PARTNER/);
  const org = await w.as(u).identity.createOrganization("Inspect Co", "INSPECTION_PARTNER");
  const pt = await w.as(u).partners.apply(org.organizationId, ["market_pollachi"]);
  await assert.rejects(w.as(u).partners.apply(org.organizationId, []), /Already/);
  assert.equal((await w.as(u).partners.list()).length, 0);
  await assert.rejects(w.as(u).partners.acceptInspection("insp_x"), /not found/i);
  const ops = await w.operator();
  await assert.rejects(w.as(ops).partners.decide(pt.partnerId, "APPROVED", ""), /reason/i);
  await w.as(ops).partners.decide(pt.partnerId, "APPROVED", "ok");
  assert.equal((await w.as(u).partners.list("INSPECTION")).length, 1);
  assert.equal((await w.as(u).partners.list("LOGISTICS")).length, 0);
});

test("inspection workflow gates the deal; PASS proceeds, FAIL needs the buyer's decision; SLA is measurable", async () => {
  const { w, seller, buyer, deal } = await dealWorld();
  const insp = await partnerOrg(w, "9700000011", "INSPECTION_PARTNER");
  const stranger = await w.login("9700000012");
  await assert.rejects(w.as(stranger).partners.requestInspection(deal.dealId, { partnerId: insp.partner.partnerId, scheduledAt: hoursFromNow(w.clock, 5), location: "Farm" }), /not found/i);
  await assert.rejects(w.as(buyer).partners.requestInspection(deal.dealId, { partnerId: "nope", scheduledAt: hoursFromNow(w.clock, 5), location: "Farm" }), /partner/i);
  await assert.rejects(w.as(buyer).partners.requestInspection(deal.dealId, { partnerId: insp.partner.partnerId, scheduledAt: hoursFromNow(w.clock, -5), location: "Farm" }), /future/);
  const i = await w.as(buyer).partners.requestInspection(deal.dealId, { partnerId: insp.partner.partnerId, scheduledAt: hoursFromNow(w.clock, 5), location: "Farm" });
  assert.equal((await dealOf(w, deal.dealId)).status, "INSPECTION_PENDING");
  await assert.rejects(w.as(seller).deals.confirmPickup(deal.dealId), /cannot move/);
  await assert.rejects(w.as(buyer).partners.requestInspection(deal.dealId, { partnerId: insp.partner.partnerId, scheduledAt: hoursFromNow(w.clock, 5), location: "x" }), /agreed deal/);
  await assert.rejects(w.as(buyer).partners.acceptInspection(i.inspectionId), /partner membership/i);
  w.clock.advanceHours(1);
  await w.as(insp).partners.acceptInspection(i.inspectionId);
  await assert.rejects(w.as(insp).partners.submitResult(i.inspectionId, { outcome: "MAYBE" as never, measurements: {}, note: "" }), /Outcome/);
  w.clock.advanceHours(5);
  await w.as(insp).partners.submitResult(i.inspectionId, { outcome: "PASS", measurements: { sampleSize: 100, defectPercent: 1.5 }, note: "Good" });
  assert.equal((await dealOf(w, deal.dealId)).status, "AGREED");
  assert.equal((await w.get<Inspection>("inspections", i.inspectionId))!.status, "DECIDED");
  const evidence = await w.find<{ kind: string; visibleTo: string[] }>("evidence");
  assert.ok(evidence.length > 0 && evidence.some((e) => e.kind === "INSPECTION_RESULT" && e.visibleTo.includes(seller.user.userId)));
  const sla = await w.as(insp).partners.sla(insp.partner.partnerId);
  assert.equal(sla.inspections.total, 1);
  assert.equal(sla.inspections.avgHoursToAccept, 1);
  assert.equal(sla.inspections.avgHoursToComplete, 6);
  assert.equal(sla.inspections.onTimeRatePercent, 100);

  // FAIL path: buyer rejects → deal cancelled and quantity released
  const lotId = deal.sellLotId;
  const i2 = await w.as(seller).partners.requestInspection(deal.dealId, { partnerId: insp.partner.partnerId, scheduledAt: hoursFromNow(w.clock, 5), location: "Farm" });
  await w.as(insp).partners.acceptInspection(i2.inspectionId);
  await w.as(insp).partners.submitResult(i2.inspectionId, { outcome: "FAIL", measurements: { moisturePercent: 12 }, note: "Wet" });
  assert.equal((await dealOf(w, deal.dealId)).status, "INSPECTION_PENDING");
  await assert.rejects(w.as(seller).partners.decideInspection(i2.inspectionId, true), /buyer decides/);
  await w.as(buyer).partners.decideInspection(i2.inspectionId, false);
  assert.equal((await dealOf(w, deal.dealId)).status, "CANCELLED");
  assert.equal((await w.get<SellLot>("sell_lots", lotId))!.quantityReserved, "0");
  // the first inspection is already DECIDED; it cannot be decided again
  await assert.rejects(w.as(buyer).partners.decideInspection(i.inspectionId, true), /Inspection is DECIDED/);
});

test("logistics: partner quotes, party books exactly one, statuses are ordered, details are protected", async () => {
  const { w, seller, buyer, deal } = await dealWorld();
  const t1 = await partnerOrg(w, "9700000021", "LOGISTICS_PARTNER", ["market_pollachi"]);
  const t2 = await partnerOrg(w, "9700000022", "LOGISTICS_PARTNER", ["market_pollachi"]);
  const far = await partnerOrg(w, "9700000023", "LOGISTICS_PARTNER", ["market_sulur"]);
  const req = await w.as(buyer).partners.requestTransport(deal.dealId, { destinationMarketId: "market_sulur", weightKg: 6000, windowFrom: hoursFromNow(w.clock, 10), windowTo: hoursFromNow(w.clock, 30) });
  assert.equal((await w.as(t1).partners.openRequests()).length, 1);
  assert.equal((await w.as(far).partners.openRequests()).length, 0, "only partners serving the pickup area see the request");
  const q = (price: number) => ({ pricePaise: price, vehicleType: "LCV", etaFrom: hoursFromNow(w.clock, 12), etaTo: hoursFromNow(w.clock, 20), validUntil: hoursFromNow(w.clock, 8) });
  await assert.rejects(w.as(far).partners.submitQuote(req.requestId, q(100)), /service area/);
  await assert.rejects(w.as(t1).partners.submitQuote(req.requestId, q(0)), /positive/);
  const q1 = await w.as(t1).partners.submitQuote(req.requestId, q(500000));
  const q2 = await w.as(t2).partners.submitQuote(req.requestId, q(450000));
  await assert.rejects(w.as(t1).partners.submitQuote(req.requestId, q(400000)), /existing quote/);
  assert.deepEqual((await w.as(seller).partners.listQuotes(req.requestId)).map((x) => x.pricePaise), [450000, 500000], "cheapest first");
  await assert.rejects(w.as(await w.login("9700000024")).partners.listQuotes(req.requestId), /not found/i);
  assert.equal((await w.as(buyer).partners.getTransport(req.requestId)).vehicle, undefined);
  const booked = await w.as(seller).partners.book(q2.quoteId, { registration: "TN37AB1234", driverPhone: "+919800000000" });
  assert.equal(booked.partnerId, t2.partner.partnerId);
  assert.equal((await w.get<TransportQuote>("transport_quotes", q1.quoteId))!.status, "REJECTED");
  await assert.rejects(w.as(buyer).partners.book(q1.quoteId, { registration: "x", driverPhone: "y" }), /Request is BOOKED|no longer valid/);
  assert.equal((await w.as(buyer).partners.getTransport(req.requestId)).vehicle!.registration, "TN37AB1234");
  await assert.rejects(w.as(t1).partners.getTransport(req.requestId), /not found/i, "losing partner cannot see vehicle details");
  await assert.rejects(w.as(t1).partners.updateTransport(req.requestId, "PICKED_UP"), /not found/i);
  await assert.rejects(w.as(t2).partners.updateTransport(req.requestId, "DELIVERED"), /cannot move/);
  await w.as(t2).partners.updateTransport(req.requestId, "PICKED_UP");
  await w.as(t2).partners.updateTransport(req.requestId, "IN_TRANSIT");
  w.clock.advanceHours(15);
  await w.as(t2).partners.updateTransport(req.requestId, "DELIVERED");
  const sla = (await w.as(t2).partners.sla(t2.partner.partnerId)).transport;
  assert.deepEqual([sla.quotesSubmitted, sla.booked, sla.delivered, sla.onTimeRatePercent], [1, 1, 1, 100]);
  assert.ok((await dealOf(w, deal.dealId)).events.some((e) => e.type === "TRANSPORT_BOOKED"));
});

async function fpoWorld() {
  const w = makeWorld();
  const mgr = await w.login("9710000001"), fin = await w.login("9710000002"), buyer = await w.login("9710000003");
  await w.verify(mgr, "ORGANIZATION_EXISTENCE"); await w.verify(buyer, "PERSON_IDENTITY");
  const org = await w.as(mgr).identity.createOrganization("Anaimalai FPO", "FPO");
  await w.as(mgr).identity.addMember(org.organizationId, fin.user.userId, "MEMBER");
  const add = (name: string, qty: string, over: Record<string, unknown> = {}) => w.as(mgr).fpo.addMemberLot(org.organizationId, { memberName: name, productId: "prod_mature_coconut", gradeGroup: "FAQ", unit: "NUT", quantity: qty, originMarketId: "market_anaimalai", quality: { husk: "WITH_HUSK" }, ...over });
  return { w, mgr, fin, buyer, org, add };
}

test("FPO aggregation keeps member ownership and rejects incompatible lots", async () => {
  const { w, mgr, fin, org, add } = await fpoWorld();
  const a = await add("Ravi", "3000"), b = await add("Meena", "5000"), c = await add("Kumar", "2000"), d = await add("Bad Grade", "1000", { gradeGroup: "PREMIUM" });
  await assert.rejects(add("", "10"), /Member name/);
  await assert.rejects(add("X", "0"), /positive/);
  await assert.rejects(w.as(mgr).fpo.reviewMemberLot(a.memberLotId, true), /different manager/);
  await assert.rejects(w.as(await w.login("9710000009")).fpo.addMemberLot(org.organizationId, { memberName: "x", productId: "prod_mature_coconut", gradeGroup: "FAQ", unit: "NUT", quantity: "1", originMarketId: "market_pollachi" }), /Not permitted/);
  const input = (ids: string[]) => ({ memberLotIds: ids, availableFrom: "2026-10-02T04:00:00Z", availableTo: "2026-10-09T04:00:00Z", expiresAt: hoursFromNow(w.clock, 100), fulfilment: { mode: "PICKUP" as const, costsIncluded: ["LOADING"], costsExcluded: [] }, priceExpectation: { inviteOffers: true as const } });
  await assert.rejects(w.as(mgr).fpo.buildAggregate(org.organizationId, input([a.memberLotId])), /NOT_APPROVED/);
  // second manager reviews (fin is a MEMBER → cannot review); promote fin to VERIFIER with step-up
  await stepUp(w, mgr);
  await w.as(mgr).identity.addMember(org.organizationId, fin.user.userId, "VERIFIER");
  for (const l of [a, b, c, d]) await w.as(fin).fpo.reviewMemberLot(l.memberLotId, true);
  await assert.rejects(w.as(mgr).fpo.buildAggregate(org.organizationId, input([a.memberLotId, d.memberLotId])), /GRADE_MISMATCH/);
  await assert.rejects(w.as(mgr).fpo.buildAggregate(org.organizationId, input([])), /at least one/);
  const { aggregate, sellLot } = await w.as(mgr).fpo.buildAggregate(org.organizationId, input([a.memberLotId, b.memberLotId, c.memberLotId]));
  assert.equal(sellLot.quantityTotal, "10000");
  assert.equal(sellLot.organizationId, org.organizationId);
  assert.deepEqual(aggregate.contributions.map((x) => [x.memberName, x.quantity]), [["Ravi", "3000"], ["Meena", "5000"], ["Kumar", "2000"]]);
  assert.equal((await w.get<MemberLot>("member_lots", a.memberLotId))!.status, "AGGREGATED");
  await assert.rejects(w.as(mgr).fpo.buildAggregate(org.organizationId, input([a.memberLotId])), /NOT_APPROVED\(AGGREGATED\)/);
});

test("settlement splits payable exactly by contribution, honors deductions, needs approval, exports safely", async () => {
  const { w, mgr, fin, buyer, org, add } = await fpoWorld();
  await stepUp(w, mgr);
  await w.as(mgr).identity.addMember(org.organizationId, fin.user.userId, "FINANCE");
  const lots = [await add("Ravi", "3333"), await add("=cmd|' /C calc'!A0", "3333"), await add("Kumar", "3334")];
  await w.as(mgr).identity.addMember(org.organizationId, fin.user.userId, "VERIFIER");
  for (const l of lots) await w.as(fin).fpo.reviewMemberLot(l.memberLotId, true);
  await w.as(mgr).identity.addMember(org.organizationId, fin.user.userId, "FINANCE");
  const { sellLot } = await w.as(mgr).fpo.buildAggregate(org.organizationId, { memberLotIds: lots.map((l) => l.memberLotId), availableFrom: "2026-10-02T04:00:00Z", availableTo: "2026-10-09T04:00:00Z", expiresAt: hoursFromNow(w.clock, 100), fulfilment: { mode: "PICKUP", costsIncluded: ["LOADING"], costsExcluded: [] }, priceExpectation: { inviteOffers: true } });
  await w.as(mgr).lots.addPhoto(sellLot.sellLotId);
  await w.as(mgr).lots.activate(sellLot.sellLotId);
  const offer = await w.as(buyer).offers.create({ sellLotId: sellLot.sellLotId, terms: sampleTerms({ quantity: "10000", unitPricePaise: 3333 }), expiresAt: hoursFromNow(w.clock, 6) });
  const deal = await w.as(mgr).offers.accept(offer.offerId);
  await assert.rejects(w.as(mgr).fpo.draftSettlement(deal.dealId), /settle after/);
  await w.as(mgr).deals.confirmDelivery(deal.dealId, "9990");
  await w.as(buyer).deals.acceptDelivery(deal.dealId);
  await assert.rejects(w.as(buyer).fpo.draftSettlement(deal.dealId), /Not permitted/);
  await assert.rejects(w.as(mgr).fpo.draftSettlement(deal.dealId, [{ type: "TRANSPORT", amountPaise: 99_999_999_999 }]), /exceed/);
  const s = await w.as(mgr).fpo.draftSettlement(deal.dealId, [{ type: "TRANSPORT", amountPaise: 100_001 }, { type: "COMMISSION", amountPaise: 50_000 }]);
  assert.equal(s.acceptedQuantity, "9990", "settles on what was actually delivered");
  assert.equal(s.grossPaise, 9990 * 3333);
  assert.equal(s.lines.reduce((a, l) => a + l.grossPaise, 0), s.grossPaise);
  assert.equal(s.lines.reduce((a, l) => a + l.deductionPaise, 0), 150_001);
  assert.equal(s.lines.reduce((a, l) => a + l.netPaise, 0), s.netPaise);
  assert.equal(s.netPaise, s.grossPaise - 150_001);
  assert.equal(s.lines.reduce((a, l) => a + Number(l.quantity), 0), 9990);
  await assert.rejects(w.as(mgr).fpo.draftSettlement(deal.dealId), /already exists/);
  await assert.rejects(w.as(mgr).fpo.exportSettlementCsv(s.settlementId), /approved/);
  await assert.rejects(w.as(mgr).fpo.approveSettlement(s.settlementId), /second manager/);
  await w.as(fin).fpo.approveSettlement(s.settlementId);
  await assert.rejects(w.as(fin).fpo.approveSettlement(s.settlementId), /Settlement is APPROVED/);
  const csv = await w.as(fin).fpo.exportSettlementCsv(s.settlementId);
  assert.match(csv, /^settlementId,dealId,member/);
  assert.equal(csv.trim().split("\n").length, 5);
  assert.match(csv, /'=cmd/, "spreadsheet formula injection is neutralised");
  assert.ok((await w.log<{ action: string }>("audit_log", { action: "SETTLEMENT_EXPORTED" })).length > 0);
});

test("media: signed upload, content sniffing, no serving before approval, attaches photos", async () => {
  const blobs = new MemoryBlobStore();
  const { w, seller, buyer, deal, lot } = await dealWorld({ blobs, baseUrl: "http://localhost:4000" });
  const S = w.as(seller).media, B = w.as(buyer).media, sys = w.sys.media;
  const sig = (url: string) => { const u = new URL(url); return [Number(u.searchParams.get("exp")), u.searchParams.get("sig")!] as const; };
  await assert.rejects(S.createUploadIntent({ purpose: "LOT_PHOTO", contentType: "application/x-msdownload", sizeBytes: 10, refId: lot.sellLotId }), /Allowed types/);
  await assert.rejects(S.createUploadIntent({ purpose: "LOT_PHOTO", contentType: "image/png", sizeBytes: 99_000_000, refId: lot.sellLotId }), /Size/);
  await assert.rejects(B.createUploadIntent({ purpose: "LOT_PHOTO", contentType: "image/png", sizeBytes: 100, refId: lot.sellLotId }), /not found/i);
  const intent = await S.createUploadIntent({ purpose: "LOT_PHOTO", contentType: "image/png", sizeBytes: 100, refId: lot.sellLotId });
  const [exp, sg] = sig(intent.uploadUrl);
  await assert.rejects(sys.receiveUpload(intent.mediaId, exp, "bad-signature", png()), /invalid or expired/);
  await assert.rejects(sys.receiveUpload(intent.mediaId, exp, sg, new Uint8Array(500)), /size/i);
  await sys.receiveUpload(intent.mediaId, exp, sg, png());
  await assert.rejects(sys.receiveUpload(intent.mediaId, exp, sg, png()), /already/i);
  const before = (await w.get<SellLot>("sell_lots", lot.sellLotId))!.photoCount;
  await assert.rejects(B.read(intent.mediaId), /not found/i);
  assert.equal((await S.read(intent.mediaId)).bytes.length, 16, "owner can see their own pending file");
  assert.equal((await sys.scan(intent.mediaId)).status, "APPROVED");
  assert.equal((await w.get<SellLot>("sell_lots", lot.sellLotId))!.photoCount, before + 1);
  assert.equal((await B.read(intent.mediaId)).media.status, "APPROVED");

  // content that lies about its type is rejected and deleted
  const bad = await S.createUploadIntent({ purpose: "LOT_PHOTO", contentType: "image/png", sizeBytes: 64, refId: lot.sellLotId });
  await sys.receiveUpload(bad.mediaId, ...sig(bad.uploadUrl), new TextEncoder().encode("<script>alert(1)</script>"));
  const rejected = await sys.scan(bad.mediaId);
  assert.deepEqual([rejected.status, rejected.rejectionReason], ["REJECTED", "CONTENT_TYPE_MISMATCH"]);
  await assert.rejects(B.read(bad.mediaId), /not found/i);
  assert.equal(await blobs.get(`private/${bad.mediaId}`), undefined);

  // deal evidence is limited to the parties
  const ev = await B.createUploadIntent({ purpose: "DEAL_EVIDENCE", contentType: "application/pdf", sizeBytes: 64, refId: deal.dealId });
  await sys.receiveUpload(ev.mediaId, ...sig(ev.uploadUrl), new TextEncoder().encode("%PDF-1.4\n1 0 obj<< /Type /Catalog >>endobj"));
  assert.equal((await sys.scan(ev.mediaId)).status, "APPROVED");
  assert.equal((await S.read(ev.mediaId)).media.mediaId, ev.mediaId);
  await assert.rejects(w.as(await w.login("9700000030")).media.read(ev.mediaId), /not found/i);
  // active PDF content rejected
  const js = await B.createUploadIntent({ purpose: "DEAL_EVIDENCE", contentType: "application/pdf", sizeBytes: 100, refId: deal.dealId });
  await sys.receiveUpload(js.mediaId, ...sig(js.uploadUrl), new TextEncoder().encode("%PDF-1.4 /JavaScript (app.alert(1))"));
  assert.equal((await sys.scan(js.mediaId)).rejectionReason, "ACTIVE_CONTENT");
  // abandoned slots are purged
  const abandoned = await S.createUploadIntent({ purpose: "LOT_PHOTO", contentType: "image/png", sizeBytes: 10, refId: lot.sellLotId });
  w.clock.advanceHours(1);
  assert.equal(await sys.purgeExpiredUploads(), 1);
  assert.equal(await w.get<Media>("media", abandoned.mediaId), undefined);
  await assert.rejects(sys.receiveUpload(abandoned.mediaId, ...sig(abandoned.uploadUrl), png()), /invalid or expired/);
});

test("HTTP: direct upload with signed URL, authorised download and release D endpoints", async () => {
  const { w, seller, buyer, lot } = await dealWorld();
  const srv = await createApp({ app: w.app });
  await new Promise<void>((r) => srv.listen(0, r));
  const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  const h = { authorization: `Bearer ${seller.token}`, "content-type": "application/json" };
  try {
    const intent = await (await fetch(`${base}/v1/uploads/intents`, { method: "POST", headers: { ...h, "idempotency-key": "u1" }, body: JSON.stringify({ purpose: "LOT_PHOTO", contentType: "image/png", sizeBytes: 100, refId: lot.sellLotId }) })).json() as any;
    assert.ok(intent.uploadUrl);
    const put = await fetch(intent.uploadUrl.startsWith("http") ? intent.uploadUrl : base + intent.uploadUrl, { method: "PUT", body: png() });
    assert.equal(put.status, 200);
    assert.equal((await fetch(`${base}/v1/uploads/${intent.mediaId}?exp=1&sig=x`, { method: "PUT", body: png() })).status, 403);
    // the worker scans new uploads as part of housekeeping (formerly POST /v1/internal/tick)
    const tick = await w.sys.maintenance.housekeeping();
    assert.equal(tick.mediaScanned, 1);
    const dl = await fetch(`${base}/v1/media/${intent.mediaId}`, { headers: { authorization: `Bearer ${buyer.token}` } });
    assert.equal(dl.status, 200);
    assert.equal(dl.headers.get("content-type"), "image/png");
    assert.match(dl.headers.get("content-security-policy") ?? "", /sandbox/);
    assert.equal((await fetch(`${base}/v1/media/${intent.mediaId}`)).status, 401);
    assert.equal((await fetch(`${base}/v1/media/${intent.mediaId}`, { headers: { authorization: `Bearer ${(await w.login("9700000040")).token}` } })).status, 200, "approved lot photos are part of the public lot view");
    const part = await fetch(`${base}/v1/partners?kind=INSPECTION`, { headers: h });
    assert.deepEqual((await part.json() as any).items, []);
  } finally { srv.close(); }
});

test("retention purge removes stale security state", async () => {
  const w = makeWorld();
  await w.login("9700000050");
  await w.sys.identity.requestOtp("9700000051", "x");
  w.clock.advanceHours(3);
  const r = await w.sys.identity.purgeStaleSecurityState();
  assert.ok(r.otpsPurged >= 1 && r.rateWindowsPurged >= 1);
  assert.equal((await w.find<User>("users")).length, 1, "accounts are untouched");
});
