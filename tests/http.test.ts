import test from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { createApp } from "@livecoco/api";
import { makeWorld } from "@livecoco/test-support";

async function boot(limit = 1000) {
  const w = makeWorld();
  const srv = await createApp({ app: w.app, requestsPerMinute: limit });
  await new Promise<void>((r) => srv.listen(0, r));
  const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const res = await fetch(base + path, { method, headers: { "content-type": "application/json", ...headers }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    return { status: res.status, json: (await res.json()) as any, headers: res.headers };
  };
  return { w, srv, base, call, close: () => srv.close() };
}

test("OTP login over HTTP, problem+json errors, correlation ids, no enumeration", async () => {
  const { w, call, close } = await boot();
  try {
    const unauth = await call("GET", "/v1/me");
    assert.equal(unauth.status, 401);
    assert.equal(unauth.json.code, "UNAUTHENTICATED");
    assert.ok(unauth.json.correlationId.startsWith("req_"));
    assert.equal(unauth.headers.get("content-type"), "application/problem+json");
    const known = await call("POST", "/v1/auth/otp/request", { phone: "9300000001" });
    const unknown = await call("POST", "/v1/auth/otp/request", { phone: "9300000002" });
    assert.deepEqual(known.json, unknown.json);
    assert.equal((await call("POST", "/v1/auth/otp/verify", { phone: "9300000001", code: "000000" })).status, 401);
    const ok = await call("POST", "/v1/auth/otp/verify", { phone: "9300000001", code: w.otps.get("+919300000001") });
    assert.equal(ok.status, 200);
    const reuse = await call("POST", "/v1/auth/otp/verify", { phone: "9300000001", code: w.otps.get("+919300000001") });
    assert.equal(reuse.status, 401, "OTP is single use");
    const me = await call("GET", "/v1/me", undefined, { authorization: `Bearer ${ok.json.token}`, "x-correlation-id": "req_test_1" });
    assert.equal(me.status, 200);
    assert.equal(me.headers.get("x-correlation-id"), "req_test_1");
    const bad = await call("POST", "/v1/auth/otp/request", { phone: "123" });
    assert.equal(bad.status, 422);
    const missing = await call("POST", "/v1/auth/otp/request", {});
    assert.equal(missing.status, 422);
    assert.deepEqual(missing.json.fieldErrors, [{ field: "phone", code: "REQUIRED" }]);
    const ta = await call("GET", "/v1/me?lang=ta");
    assert.match(ta.json.message, /உள்நுழை/);
    assert.equal((await call("GET", "/v1/nope")).status, 404);
  } finally { close(); }
});

test("OTP requests are rate limited per phone", async () => {
  const { call, close } = await boot();
  try {
    const codes: number[] = [];
    for (let i = 0; i < 7; i++) codes.push((await call("POST", "/v1/auth/otp/request", { phone: "9300000009" })).status);
    assert.deepEqual(codes.slice(0, 5), [200, 200, 200, 200, 200]);
    assert.equal(codes[5], 429);
  } finally { close(); }
});

test("OTP limits are per phone; users sharing one network address are not locked out by each other", async () => {
  const { call, close } = await boot();
  try {
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) statuses.push((await call("POST", "/v1/auth/otp/request", { phone: `98000001${String(i).padStart(2, "0")}` })).status);
    assert.deepEqual([...new Set(statuses)], [200]);
  } finally { close(); }
});

test("idempotency: same key replays, different payload conflicts, missing key rejected", async () => {
  const { w, call, close } = await boot();
  try {
    const u = await w.login("9300000003");
    const h = { authorization: `Bearer ${u.token}` };
    const body = { name: "Pollachi FPO", kind: "FPO" };
    assert.equal((await call("POST", "/v1/organizations", body, h)).status, 400);
    const a = await call("POST", "/v1/organizations", body, { ...h, "idempotency-key": "k1" });
    const b = await call("POST", "/v1/organizations", body, { ...h, "idempotency-key": "k1" });
    assert.equal(a.status, 201);
    assert.deepEqual(a.json, b.json);
    assert.equal((await w.find("organizations")).length, 1);
    const c = await call("POST", "/v1/organizations", { ...body, name: "Other" }, { ...h, "idempotency-key": "k1" });
    assert.equal(c.status, 409);
    assert.equal(c.json.code, "IDEMPOTENCY_KEY_REUSED");
  } finally { close(); }
});

test("public prices endpoint, malformed bodies, payload limits and operator step-up over HTTP", async () => {
  const { w, call, close, base } = await boot();
  try {
    await w.sys.prices.ingestRaw("agmarknet", [{ state: "Tamil Nadu", market: "Pollachi", commodity: "Coconut", grade: "FAQ", arrival_date: "01/10/2026", min_price: "2900", max_price: "3200", modal_price: "3050", price_unit: "Rs./Quintal" }]);
    const prices = await call("GET", "/v1/prices/latest");
    assert.equal(prices.status, 200);
    assert.equal(prices.json.items[0].kind, "OFFICIAL_OBSERVATION_ONLY");
    assert.equal(prices.json.disclaimerKey, "price.not_offer");
    assert.match(prices.headers.get("cache-control") ?? "", /public/);
    assert.equal((await call("GET", "/v1/prices/msp")).json.items[0].isMarketQuote, false);
    const raw = await fetch(base + "/v1/auth/otp/request", { method: "POST", body: "{not json" });
    assert.equal(raw.status, 400);
    const big = await fetch(base + "/v1/auth/otp/request", { method: "POST", body: JSON.stringify({ phone: "9".repeat(400_000) }) }).catch(() => ({ status: 413 }));
    assert.ok([413].includes(big.status) || big.status === 400);
    const op = await w.login("+919000000001");
    const h = { authorization: `Bearer ${op.token}` };
    const blocked = await call("GET", "/v1/ops/queues", undefined, h);
    assert.equal(blocked.status, 403);
    assert.equal(blocked.json.code, "STEP_UP_REQUIRED");
    await w.sys.identity.requestOtp("+919000000001", "x");
    assert.equal((await call("POST", "/v1/auth/step-up", { code: w.otps.get("+919000000001") }, h)).status, 200);
    assert.equal((await call("GET", "/v1/ops/queues", undefined, h)).status, 200);
    const normal = await w.login("9300000005");
    assert.equal((await call("GET", "/v1/ops/audit", undefined, { authorization: `Bearer ${normal.token}` })).status, 403);
  } finally { close(); }
});

test("full marketplace flow over HTTP", async () => {
  const { w, call, close } = await boot();
  try {
    const seller = await w.login("9400000001"), buyer = await w.login("9400000002");
    await w.verify(seller, "PERSON_IDENTITY"); await w.verify(buyer, "PERSON_IDENTITY");
    const hs = { authorization: `Bearer ${seller.token}` }, hb = { authorization: `Bearer ${buyer.token}` };
    const exp = (h: number) => new Date(w.clock.now().getTime() + h * 3_600_000).toISOString();
    const lot = await call("POST", "/v1/sell-lots", { productId: "prod_mature_coconut", gradeAttributes: { husk: "WITH_HUSK" }, gradeGroup: "FAQ", unit: "NUT", quantityTotal: "5000", partialFulfilmentAllowed: false, originMarketId: "market_pollachi", availableFrom: exp(1), availableTo: exp(48), expiresAt: exp(72), fulfilment: { mode: "PICKUP", costsIncluded: ["LOADING"], costsExcluded: [] }, priceExpectation: { inviteOffers: true } }, { ...hs, "idempotency-key": "lot1" });
    assert.equal(lot.status, 201);
    const id = lot.json.sellLotId;
    assert.equal((await call("POST", `/v1/sell-lots/${id}/activate`, {}, { ...hs, "idempotency-key": "a1" })).status, 422);
    await call("POST", `/v1/sell-lots/${id}/photos`, {}, hs);
    assert.equal((await call("POST", `/v1/sell-lots/${id}/activate`, {}, { ...hs, "idempotency-key": "a2" })).json.status, "ACTIVE");
    const list = await call("GET", "/v1/sell-lots?productId=prod_mature_coconut");
    assert.equal(list.json.items.length, 1);
    assert.equal(list.json.page.hasMore, false);
    assert.equal(JSON.stringify(list.json).includes("sellerId"), false);
    const terms = { quantity: "5000", unit: "NUT", unitPricePaise: 3000, gradeGroup: "FAQ", fulfilmentMode: "PICKUP", costsIncluded: ["LOADING"], costsExcluded: [], weighmentMethod: "COUNT", weighmentLocation: "Farm", paymentMethod: "UPI", paymentDue: "ON_LOADING", fulfilmentFrom: exp(2), fulfilmentBy: exp(40), acceptanceWindowHours: 24, inspectionTerms: "x" };
    const offer = await call("POST", "/v1/offers", { sellLotId: id, terms, expiresAt: exp(6) }, { ...hb, "idempotency-key": "o1" });
    assert.equal(offer.status, 201);
    const stale = await call("POST", `/v1/offers/${offer.json.offerId}/accept`, {}, { ...hs, "idempotency-key": "acc0", "if-match": "99" });
    assert.equal(stale.status, 409);
    const deal = await call("POST", `/v1/offers/${offer.json.offerId}/accept`, {}, { ...hs, "idempotency-key": "acc1" });
    assert.equal(deal.status, 201);
    const again = await call("POST", `/v1/offers/${offer.json.offerId}/accept`, {}, { ...hs, "idempotency-key": "acc1" });
    assert.equal(again.json.dealId, deal.json.dealId, "retry returns the original deal");
    const race = await call("POST", `/v1/offers/${offer.json.offerId}/accept`, {}, { ...hs, "idempotency-key": "acc2" });
    assert.equal(race.status, 409);
    assert.equal((await call("GET", `/v1/deals/${deal.json.dealId}`, undefined, hb)).json.cards.length, 1);
    const stranger = await w.login("9400000003");
    assert.equal((await call("GET", `/v1/deals/${deal.json.dealId}`, undefined, { authorization: `Bearer ${stranger.token}` })).status, 404);
    for (const [path, h] of [["delivery", hs], ["accept", hb]] as const) assert.equal((await call("POST", `/v1/deals/${deal.json.dealId}/${path}`, {}, { ...h, "idempotency-key": path })).status, 200);
    assert.equal((await call("POST", `/v1/deals/${deal.json.dealId}/payment`, { method: "UPI" }, { ...hs, "idempotency-key": "pay" })).json.status, "PAYMENT_CONFIRMED");
    assert.equal((await call("POST", `/v1/deals/${deal.json.dealId}/complete`, {}, { ...hs, "idempotency-key": "done" })).json.status, "COMPLETED");
  } finally { close(); }
});

test("there are no internal HTTP endpoints: the worker works on the database directly", async () => {
  const { w, call, close } = await boot();
  try {
    const user = await w.login("9500000001");
    for (const path of ["/v1/internal/tick", "/v1/internal/ingest", "/v1/internal/outbox/claim"]) {
      assert.equal((await call("POST", path, {}, { authorization: `Bearer ${user.token}`, "x-internal-token": "anything" })).status, 404);
    }
  } finally { close(); }
});

test("concurrent requests from one user do not lose each other's writes", async () => {
  const { w, call, close } = await boot();
  try {
    const u = await w.login("9500000002");
    const h = { authorization: `Bearer ${u.token}` };
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => call("POST", "/v1/organizations", { name: `Org ${i}`, kind: i % 2 ? "FPO" : "NOT_A_KIND" }, { ...h, "idempotency-key": `org-${i}` })));
    assert.deepEqual(results.map((r) => r.status).sort(), [...Array(5).fill(201), ...Array(5).fill(422)].sort());
    assert.equal((await w.find("organizations")).length, 5);
    assert.equal((await call("GET", "/v1/me/organizations", undefined, h)).json.items.length, 5, "every successful request's membership survived the others");
  } finally { close(); }
});
