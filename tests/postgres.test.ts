import test from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { randomBytes } from "node:crypto";
import { PgStore } from "../packages/database/src/pg.ts";
import { Platform } from "../apps/api/src/platform.ts";
import { createApp } from "../apps/api/src/server.ts";
import { FakeClock, OPS_CAPS, hoursFromNow, sampleTerms } from "../packages/test-support/src/index.ts";

const URL_ = process.env.DATABASE_URL;
const skip = URL_ ? false : "DATABASE_URL not set (start Postgres with `docker compose up -d db`)";

/** A fully isolated schema per test; torn down afterwards. */
async function boot() {
  const schema = `t_${randomBytes(6).toString("hex")}`;
  const clock = new FakeClock();
  const otps = new Map<string, string>();
  const mk = () => new Platform({ clock: clock.now, deliverOtp: (p, c) => otps.set(p, c), operators: { "+919000000001": [...OPS_CAPS], "+919000000002": [...OPS_CAPS] } });
  const store = new PgStore({ connectionString: URL_ as string, schema });
  await store.migrate();
  await store.acquireWriterLock();
  const p = mk();
  await store.load(p);
  const tx = <T>(fn: () => T) => store.withTransaction(p, fn);
  const login = (phone: string, device = "d") => tx(() => { p.requestOtp(phone, device + phone); const { token, user } = p.verifyOtp(phone, otps.get(phone.startsWith("+") ? phone : `+91${phone}`) as string, device + phone); return { token, user, session: p.authenticate(token).session }; });
  const cleanup = async () => { await store.pool.query(`drop schema ${schema} cascade`).catch(() => {}); await store.close(); };
  /** Simulate a process restart: new store + platform over the same schema. */
  const restart = async () => {
    await store.close();
    const s2 = new PgStore({ connectionString: URL_ as string, schema });
    await s2.migrate(); await s2.acquireWriterLock();
    const p2 = mk();
    await s2.load(p2);
    return { s2, p2 };
  };
  return { schema, clock, otps, store, p, tx, login, cleanup, restart, mk };
}

test("migrations are idempotent and checksummed", { skip }, async () => {
  const w = await boot();
  try {
    assert.deepEqual(await w.store.migrate(), []);
    const rows = (await w.store.pool.query("select name from schema_migrations")).rows;
    assert.deepEqual(rows.map((r) => r.name).sort(), ["001_init.sql", "002_release_d.sql", "003_outbox.sql"]);
    await w.store.pool.query("update schema_migrations set checksum = 'tampered'");
    await assert.rejects(() => w.store.migrate(), /modified after being applied/);
  } finally { await w.cleanup(); }
});

test("state survives a restart: users, sessions, lots, deals, audit", { skip }, async () => {
  const w = await boot();
  let cleanup = w.cleanup;
  try {
    const seller = await w.login("9600000001"), buyer = await w.login("9600000002");
    const ops = await w.login("+919000000001");
    await w.tx(() => {
      for (const u of [seller.user, buyer.user]) { const c = w.p.submitClaim(u, "PERSON_IDENTITY", {}, ["doc"]); w.p.require(ops.user, (ops.session.stepUpUntil = Date.now() + 1e9, ops.session), "ops.verification"); w.p.decideClaim(ops.user, ops.session, c.claimId, "APPROVED", "OK"); }
    });
    const lot = await w.tx(() => { const l = w.p.createLot(seller.user, { productId: "prod_mature_coconut", gradeAttributes: { husk: "WITH_HUSK" }, gradeGroup: "FAQ", unit: "NUT", quantityTotal: "10000", partialFulfilmentAllowed: true, originMarketId: "market_anaimalai", availableFrom: "2026-10-02T04:00:00Z", availableTo: "2026-10-06T04:00:00Z", expiresAt: hoursFromNow(w.clock, 72), fulfilment: { mode: "PICKUP", costsIncluded: ["LOADING"], costsExcluded: [] }, priceExpectation: { unitPricePaise: 3000 } }); w.p.addLotPhoto(seller.user, l.sellLotId); return w.p.activateLot(seller.user, l.sellLotId); });
    const offer = await w.tx(() => w.p.createOffer(buyer.user, { sellLotId: lot.sellLotId, terms: sampleTerms({ quantity: "4000" }), expiresAt: hoursFromNow(w.clock, 6) }));
    const deal = await w.tx(() => w.p.acceptOffer(seller.user, offer.offerId));

    const { s2, p2 } = await w.restart();
    cleanup = async () => { await s2.pool.query(`drop schema ${w.schema} cascade`); await s2.close(); };
    assert.equal(p2.lots.get(lot.sellLotId)!.quantityReserved, "4000");
    assert.equal(p2.deals.get(deal.dealId)!.status, "AGREED");
    assert.equal(p2.deals.get(deal.dealId)!.cards.length, 1);
    assert.ok(Object.isFrozen(p2.deals.get(deal.dealId)!.cards[0]), "immutable history is re-frozen after load");
    assert.equal(p2.authenticate(seller.token).user.userId, seller.user.userId, "sessions survive restarts");
    assert.equal(p2.phoneIndex.get("+919600000001"), seller.user.userId);
    assert.ok(p2.audit.some((a) => a.action === "OFFER_ACCEPTED"));
    assert.equal(p2.audit.length, w.p.audit.length);
    // and the new process can keep working
    await s2.withTransaction(p2, () => p2.confirmDelivery(p2.users.get(seller.user.userId)!, deal.dealId));
    assert.equal((await s2.pool.query("select status from deals")).rows[0].status, "DELIVERED");
  } finally { await cleanup(); }
});

test("a failing request rolls memory back to the committed state", { skip }, async () => {
  const w = await boot();
  try {
    const u = await w.login("9600000003");
    const before = structuredClone(w.p.users.get(u.user.userId));
    await assert.rejects(() => w.tx(() => { const me = w.p.users.get(u.user.userId)!; w.p.createOrganization(me, "Half done", "TRADER"); w.p.updateProfile(me, { displayName: "mutated" }); throw new Error("boom"); }), /boom/);
    assert.equal(w.p.orgs.size, 0);
    assert.deepEqual(w.p.users.get(u.user.userId), before);
    assert.equal((await w.store.pool.query("select count(*)::int n from organizations")).rows[0].n, 0);
    assert.equal(w.p.audit.length, (await w.store.pool.query("select count(*)::int n from audit_log")).rows[0].n);
    await w.tx(() => w.p.createOrganization(w.p.users.get(u.user.userId)!, "Fine", "TRADER"));
    assert.equal((await w.store.pool.query("select count(*)::int n from organizations")).rows[0].n, 1);
  } finally { await w.cleanup(); }
});

test("failed OTP attempts are committed (brute force protection survives errors and restarts)", { skip }, async () => {
  const w = await boot();
  try {
    await w.tx(() => w.p.requestOtp("9600000004", "dev"));
    for (let i = 0; i < 5; i++) await assert.rejects(() => w.tx(() => w.p.verifyOtp("9600000004", "000000", "dev")), /invalid or expired/);
    const real = w.otps.get("+919600000004")!;
    await assert.rejects(() => w.tx(() => w.p.verifyOtp("9600000004", real, "dev")), /invalid or expired/, "locked after 5 wrong attempts");
    const { p2, s2 } = await w.restart();
    await assert.rejects(() => s2.withTransaction(p2, () => p2.verifyOtp("9600000004", real, "dev")), /invalid or expired/, "lock persists across restart");
    await s2.close();
  } finally { await w.store.pool.end().catch(() => {}); const c = new PgStore({ connectionString: URL_ as string }); await c.pool.query(`drop schema ${w.schema} cascade`); await c.close(); }
});

test("database enforces integrity independently of the application", { skip }, async () => {
  const w = await boot();
  try {
    const u = await w.login("9600000005");
    const q = (sql: string, params: unknown[] = []) => w.store.pool.query(sql, params);
    // append-only log
    await q("insert into audit_log (idx, doc) values (0, '{}')");
    await assert.rejects(() => q("update audit_log set doc = '{}'"), /append-only/);
    await assert.rejects(() => q("delete from audit_log"), /append-only/);
    // phone format and uniqueness
    await assert.rejects(() => q("insert into users (key, doc) values ('x', '{\"phone\":\"123\",\"suspended\":false}')"), /users_phone_e164/);
    await assert.rejects(() => q("insert into users (key, doc) values ('y', $1::jsonb)", [JSON.stringify({ phone: u.user.phone, suspended: false })]), /users_phone_uq/);
    // oversell
    const lotDoc = { sellerId: "s", productId: "prod_mature_coconut", status: "ACTIVE", expiresAt: "2030-01-01T00:00:00Z", quantityTotal: "100", quantityReserved: "101" };
    await assert.rejects(() => q("insert into sell_lots (key, doc) values ('l1', $1::jsonb)", [JSON.stringify(lotDoc)]), /lot_never_oversold/);
    await q("insert into sell_lots (key, doc) values ('l1', $1::jsonb)", [JSON.stringify({ ...lotDoc, quantityReserved: "0" })]);
    await assert.rejects(() => q("update sell_lots set doc = doc || '{\"quantityReserved\":\"500\"}'"), /lot_never_oversold/);
    // price observation sanity and immutability
    const obs = { productId: "prod_mature_coconut", marketId: "market_pollachi", unit: "NUT", state: "ELIGIBLE", sourceClass: "VERIFIED_QUOTE", organizationId: "o", observedAt: "2026-10-01T00:00:00Z", lowPaise: 100, highPaise: 200, referencePaise: 150 };
    await assert.rejects(() => q("insert into price_observations (key, doc) values ('o1', $1::jsonb)", [JSON.stringify({ ...obs, lowPaise: 300 })]), /obs_low_le_high/);
    await q("insert into price_observations (key, doc) values ('o1', $1::jsonb)", [JSON.stringify(obs)]);
    await assert.rejects(() => q("update price_observations set doc = doc || '{\"highPaise\":9999}'"), /immutable/);
    await q("update price_observations set doc = doc || '{\"state\":\"REJECTED\"}'");
    // raw source payload immutable; duplicate raw payloads rejected
    const raw = { source: "agmarknet", hash: "h1", payload: {} };
    await q("insert into raw_records (key, doc) values ('r1', $1::jsonb)", [JSON.stringify(raw)]);
    await assert.rejects(() => q("insert into raw_records (key, doc) values ('r2', $1::jsonb)", [JSON.stringify(raw)]), /raw_records_source_hash_uq/);
    await assert.rejects(() => q("update raw_records set doc = doc || '{\"x\":1}'"), /append-only/);
    // offers: terms immutable; one active offer per thread
    const offer = { threadId: "t", sellLotId: "l1", sellerId: "s", buyerId: "b", status: "ACTIVE", terms: { quantity: "1" }, expiresAt: "x", revision: 1, createdByPartyId: "b" };
    await q("insert into offers (key, doc) values ('f1', $1::jsonb)", [JSON.stringify(offer)]);
    await assert.rejects(() => q("insert into offers (key, doc) values ('f2', $1::jsonb)", [JSON.stringify(offer)]), /offers_one_active_per_thread_uq/);
    await assert.rejects(() => q("update offers set doc = jsonb_set(doc, '{terms,quantity}', '\"9\"')"), /immutable/);
    await q("update offers set doc = doc || '{\"status\":\"COUNTERED\"}'");
    // deal card history can only grow
    const card = { revision: 1, totalPaise: 10 };
    const deal = { sellerId: "s", buyerId: "b", sellLotId: "l1", status: "AGREED", cards: [card], events: [{ seq: 1 }] };
    await assert.rejects(() => q("insert into deals (key, doc) values ('d0', $1::jsonb)", [JSON.stringify({ ...deal, cards: [] })]), /deal_has_card/);
    await q("insert into deals (key, doc) values ('d1', $1::jsonb)", [JSON.stringify(deal)]);
    await assert.rejects(() => q("update deals set doc = jsonb_set(doc, '{cards,0,totalPaise}', '99')"), /immutable/);
    await assert.rejects(() => q("update deals set doc = jsonb_set(doc, '{events}', '[]')"), /cannot shrink/);
    await q("update deals set doc = jsonb_set(doc, '{cards}', (doc->'cards') || '[{\"revision\":2}]')");
    await assert.rejects(() => q("delete from deals"), /cannot be deleted/);
    // resolved disputes are final and need a resolution
    await assert.rejects(() => q("insert into disputes (key, doc) values ('x1', $1::jsonb)", [JSON.stringify({ dealId: "d1", status: "RESOLVED" })]), /dispute_resolved_has_resolution/);
    await q("insert into disputes (key, doc) values ('x1', $1::jsonb)", [JSON.stringify({ dealId: "d1", status: "RESOLVED", resolution: { outcome: "REJECTED" } })]);
    await assert.rejects(() => q("update disputes set doc = doc || '{\"x\":1}'"), /final/);
    await assert.rejects(() => q("insert into disputes (key, doc) values ('x2', $1::jsonb)", [JSON.stringify({ dealId: "d1", status: "OPEN" })]), /disputes_deal_uq/);
  } finally { await w.cleanup(); }
});

test("only one writer process per database", { skip }, async () => {
  const w = await boot();
  try {
    const second = new PgStore({ connectionString: URL_ as string, schema: w.schema });
    await assert.rejects(() => second.acquireWriterLock(), /already holds the writer lock/);
    await second.close();
  } finally { await w.cleanup(); }
});

test("concurrent acceptances are serialised: exactly one wins, nothing is oversold", { skip }, async () => {
  const w = await boot();
  try {
    const ops = await w.login("+919000000001");
    ops.session.stepUpUntil = Date.now() + 1e9;
    const seller = await w.login("9600000010");
    const buyers = await Promise.all([11, 12, 13, 14].map((n) => w.login(`96000000${n}`)));
    await w.tx(() => { for (const u of [seller.user, ...buyers.map((b) => b.user)]) { const c = w.p.submitClaim(u, "PERSON_IDENTITY", {}, ["d"]); w.p.decideClaim(ops.user, ops.session, c.claimId, "APPROVED", "OK"); } });
    const lot = await w.tx(() => { const l = w.p.createLot(seller.user, { productId: "prod_mature_coconut", gradeAttributes: { husk: "W" }, gradeGroup: "FAQ", unit: "NUT", quantityTotal: "5000", partialFulfilmentAllowed: false, originMarketId: "market_pollachi", availableFrom: "2026-10-02T04:00:00Z", availableTo: "2026-10-06T04:00:00Z", expiresAt: hoursFromNow(w.clock, 72), fulfilment: { mode: "PICKUP", costsIncluded: ["X"], costsExcluded: [] }, priceExpectation: { inviteOffers: true } }); w.p.addLotPhoto(seller.user, l.sellLotId); return w.p.activateLot(seller.user, l.sellLotId); });
    const offers = [];
    for (const b of buyers) offers.push(await w.tx(() => w.p.createOffer(b.user, { sellLotId: lot.sellLotId, terms: sampleTerms({ quantity: "5000" }), expiresAt: hoursFromNow(w.clock, 6) })));
    const results = await Promise.allSettled(offers.map((o) => w.tx(() => w.p.acceptOffer(seller.user, o.offerId))));
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal((await w.store.pool.query("select count(*)::int n from deals")).rows[0].n, 1);
    assert.equal((await w.store.pool.query("select quantity_reserved::text q from sell_lots")).rows[0].q, "5000");
  } finally { await w.cleanup(); }
});

test("HTTP API on Postgres: durable, idempotent retries replay the original, reads skip entity diffing", { skip }, async () => {
  const w = await boot();
  const srv = await createApp({ platform: w.p, store: w.store });
  await new Promise<void>((r) => srv.listen(0, r));
  const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => { const r = await fetch(base + path, { method, headers: { "content-type": "application/json", ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) }); return { status: r.status, json: (await r.json()) as any }; };
  try {
    await call("POST", "/v1/auth/otp/request", { phone: "9600000020" });
    const v = await call("POST", "/v1/auth/otp/verify", { phone: "9600000020", code: w.otps.get("+919600000020") });
    const h = { authorization: `Bearer ${v.json.token}` };
    const a = await call("POST", "/v1/organizations", { name: "Durable FPO", kind: "FPO" }, { ...h, "idempotency-key": "k" });
    assert.equal(a.status, 201);
    const bad = await call("POST", "/v1/organizations", { name: "Bad", kind: "NOPE" }, { ...h, "idempotency-key": "k2" });
    assert.equal(bad.status, 422);
    // a "restart" replays the same idempotent request to the same answer
    srv.close();
    const { s2, p2 } = await w.restart();
    const srv2 = await createApp({ platform: p2, store: s2 });
    await new Promise<void>((r) => srv2.listen(0, r));
    const base2 = `http://127.0.0.1:${(srv2.address() as AddressInfo).port}`;
    const r = await fetch(base2 + "/v1/organizations", { method: "POST", headers: { ...h, "content-type": "application/json", "idempotency-key": "k" }, body: JSON.stringify({ name: "Durable FPO", kind: "FPO" }) });
    assert.deepEqual(await r.json(), a.json);
    assert.equal(p2.orgs.size, 1);
    assert.equal((await fetch(base2 + "/v1/me", { headers: h })).status, 200, "session still valid after restart");
    srv2.close();
    await s2.pool.query(`drop schema ${w.schema} cascade`); await s2.close();
  } finally { srv.close(); }
});

test("Release D integrity: settlements balance, one booked quote, immutable inspection results and aggregates", { skip }, async () => {
  const w = await boot();
  try {
    const q = (sql: string, params: unknown[] = []) => w.store.pool.query(sql, params);
    const line = (g: number, d: number) => ({ memberLotId: `m${g}`, grossPaise: g, deductionPaise: d, netPaise: g - d });
    const settle = (over: Record<string, unknown> = {}) => ({ dealId: "d1", organizationId: "o", status: "DRAFT", grossPaise: 100, deductionTotalPaise: 10, netPaise: 90, lines: [line(60, 6), line(40, 4)], ...over });
    await assert.rejects(() => q("insert into settlements (key, doc) values ('s0', $1::jsonb)", [JSON.stringify(settle({ lines: [line(60, 6), line(41, 4)] }))]), /settlement_lines_balance/);
    await assert.rejects(() => q("insert into settlements (key, doc) values ('s0', $1::jsonb)", [JSON.stringify(settle({ netPaise: 95 }))]), /settlement_(net|lines_balance)/);
    await assert.rejects(() => q("insert into settlements (key, doc) values ('s0', $1::jsonb)", [JSON.stringify(settle({ status: "APPROVED" }))]), /approver/);
    await q("insert into settlements (key, doc) values ('s1', $1::jsonb)", [JSON.stringify(settle())]);
    await assert.rejects(() => q("insert into settlements (key, doc) values ('s2', $1::jsonb)", [JSON.stringify(settle())]), /settlements_deal_uq/);
    await assert.rejects(() => q("update settlements set doc = doc || '{\"grossPaise\":100,\"lines\":[]}'"), /lines_balance|cannot change/);
    await q("update settlements set doc = doc || '{\"status\":\"APPROVED\",\"approvedBy\":\"u\"}'");
    await assert.rejects(() => q("update settlements set doc = doc || '{\"x\":1}'"), /immutable/);
    await assert.rejects(() => q("delete from settlements"), /cannot be deleted/);

    const quote = (id: string, status: string) => q("insert into transport_quotes (key, doc) values ($1, $2::jsonb)", [id, JSON.stringify({ requestId: "r", partnerId: "p" + id, status, pricePaise: 100 })]);
    await assert.rejects(() => q("insert into transport_quotes (key, doc) values ('z', $1::jsonb)", [JSON.stringify({ requestId: "r", partnerId: "p", status: "OFFERED", pricePaise: 0 })]), /quote_price_positive/);
    await quote("a", "ACCEPTED");
    await assert.rejects(() => quote("b", "ACCEPTED"), /quotes_one_accepted_per_request_uq/);
    await quote("c", "OFFERED");

    const insp = (id: string, status: string) => q("insert into inspections (key, doc) values ($1, $2::jsonb)", [id, JSON.stringify({ dealId: "d1", partnerId: "p", status, result: status === "COMPLETED" ? { outcome: "PASS" } : undefined })]);
    await insp("i1", "REQUESTED");
    await assert.rejects(() => insp("i2", "REQUESTED"), /inspections_one_open_per_deal_uq/);
    await q("update inspections set doc = doc || '{\"status\":\"COMPLETED\",\"result\":{\"outcome\":\"PASS\"}}' where key = 'i1'");
    await assert.rejects(() => q("update inspections set doc = jsonb_set(doc, '{result,outcome}', '\"FAIL\"')"), /immutable/);

    await q("insert into aggregate_lots (key, doc) values ('g1', $1::jsonb)", [JSON.stringify({ organizationId: "o", sellLotId: "l1", contributions: [] })]);
    await assert.rejects(() => q("update aggregate_lots set doc = doc || '{\"x\":1}'"), /append-only/);
    await assert.rejects(() => q("insert into aggregate_lots (key, doc) values ('g2', $1::jsonb)", [JSON.stringify({ organizationId: "o", sellLotId: "l1", contributions: [] })]), /aggregate_lots_sell_lot_uq/);
    await assert.rejects(() => q("insert into member_lots (key, doc) values ('m1', $1::jsonb)", [JSON.stringify({ organizationId: "o", status: "APPROVED", quantity: "0" })]), /member_lot_quantity_positive/);
    await assert.rejects(() => q("insert into media (key, doc) values ('x', $1::jsonb)", [JSON.stringify({ ownerId: "u", status: "APPROVED", purpose: "LOT_PHOTO", contentType: "application/x-msdownload" })]), /media_content_type/);
    await assert.rejects(() => q("insert into deals (key, doc) values ('dd', $1::jsonb)", [JSON.stringify({ sellerId: "s", buyerId: "b", sellLotId: "l", status: "WEIRD", cards: [{}], events: [] })]), /deal_status/);
    await q("insert into deals (key, doc) values ('dd', $1::jsonb)", [JSON.stringify({ sellerId: "s", buyerId: "b", sellLotId: "l", status: "INSPECTION_PENDING", cards: [{}], events: [] })]);
  } finally { await w.cleanup(); }
});

test("Release D end to end on Postgres: settlement is stored balanced and survives restart", { skip }, async () => {
  const w = await boot();
  let cleanup = w.cleanup;
  try {
    const ops = await w.login("+919000000001"); ops.session.stepUpUntil = Date.now() + 1e9;
    const mgr = await w.login("9610000001"), fin = await w.login("9610000002"), buyer = await w.login("9610000003");
    const idv = (u: { userId: string }, type: "ORGANIZATION_EXISTENCE" | "PERSON_IDENTITY") => w.tx(() => { const c = w.p.submitClaim(w.p.users.get(u.userId)!, type, {}, ["d"]); w.p.decideClaim(ops.user, ops.session, c.claimId, "APPROVED", "OK"); });
    await idv(mgr.user, "ORGANIZATION_EXISTENCE"); await idv(buyer.user, "PERSON_IDENTITY");
    const me = () => w.p.users.get(mgr.user.userId)!;
    const org = await w.tx(() => w.p.createOrganization(me(), "FPO", "FPO"));
    await w.tx(() => { mgr.session.stepUpUntil = Date.now() + 1e9; w.p.addMember(me(), org.organizationId, fin.user.userId, "OWNER", mgr.session); });
    const lots = await w.tx(() => ["Ravi:6000", "Meena:4000"].map((x) => { const [n, q] = x.split(":"); return w.p.fx.addMemberLot(me(), org.organizationId, { memberName: n!, productId: "prod_mature_coconut", gradeGroup: "FAQ", unit: "NUT", quantity: q!, originMarketId: "market_pollachi", quality: { husk: "W" } }); }));
    await w.tx(() => lots.forEach((l) => w.p.fx.reviewMemberLot(w.p.users.get(fin.user.userId)!, l.memberLotId, true)));
    const { sellLot } = await w.tx(() => w.p.fx.buildAggregate(me(), org.organizationId, { memberLotIds: lots.map((l) => l.memberLotId), availableFrom: "2026-10-02T04:00:00Z", availableTo: "2026-10-09T04:00:00Z", expiresAt: hoursFromNow(w.clock, 100), fulfilment: { mode: "PICKUP", costsIncluded: ["X"], costsExcluded: [] }, priceExpectation: { inviteOffers: true } }));
    await w.tx(() => { w.p.addLotPhoto(me(), sellLot.sellLotId); w.p.activateLot(me(), sellLot.sellLotId); });
    const offer = await w.tx(() => w.p.createOffer(w.p.users.get(buyer.user.userId)!, { sellLotId: sellLot.sellLotId, terms: sampleTerms({ quantity: "10000", unitPricePaise: 3001 }), expiresAt: hoursFromNow(w.clock, 6) }));
    const deal = await w.tx(() => w.p.acceptOffer(me(), offer.offerId));
    await w.tx(() => { w.p.confirmDelivery(me(), deal.dealId); w.p.acceptDelivery(w.p.users.get(buyer.user.userId)!, deal.dealId); });
    const s = await w.tx(() => w.p.fx.draftSettlement(me(), deal.dealId, [{ type: "COMMISSION", amountPaise: 33_333 }]));
    const row = (await w.store.pool.query("select gross_paise::int g, deduction_total_paise::int d, net_paise::int n, status from settlements")).rows[0];
    assert.deepEqual([row.g, row.d, row.n, row.status], [30_010_000 / 1, 33_333, 30_010_000 - 33_333, "DRAFT"]);
    await w.tx(() => w.p.fx.approveSettlement(w.p.users.get(fin.user.userId)!, s.settlementId));
    const { s2, p2 } = await w.restart();
    cleanup = async () => { await s2.pool.query(`drop schema ${w.schema} cascade`); await s2.close(); };
    const loaded = p2.fx.settlements.get(s.settlementId)!;
    assert.equal(loaded.status, "APPROVED");
    assert.equal(loaded.lines.reduce((a, l) => a + l.netPaise, 0), loaded.netPaise);
    assert.match(p2.fx.exportSettlementCsv(p2.users.get(fin.user.userId)!, s.settlementId), /Ravi/);
  } finally { await cleanup(); }
});

test("outbox rows commit atomically with the state change and vanish on rollback", { skip }, async () => {
  const w = await boot();
  try {
    const a = await w.login("9620000001"), b = await w.login("9620000002");
    const org = await w.tx(() => w.p.createOrganization(w.p.users.get(a.user.userId)!, "O", "TRADER"));
    const before = (await w.store.pool.query("select count(*)::int n from outbox")).rows[0].n;
    await assert.rejects(() => w.tx(() => { w.p.notify(b.user.userId, "SMS", "claim.approved", {}, "k1"); throw new Error("boom"); }), /boom/);
    assert.equal((await w.store.pool.query("select count(*)::int n from outbox")).rows[0].n, before, "rolled back with the failed request");
    assert.equal(w.p.outbox.size, before);
    await w.tx(() => { w.p.notify(b.user.userId, "SMS", "claim.approved", {}, "k1"); });
    assert.equal((await w.store.pool.query("select count(*)::int n from outbox")).rows[0].n, before + 1);
    const id = (await w.store.pool.query("select key from outbox where doc->>'template' = 'claim.approved'")).rows[0].key as string;
    await w.tx(() => w.p.claimOutbox(5));
    await w.tx(() => w.p.ackOutbox(id, true));
    await assert.rejects(() => w.store.pool.query("update outbox set doc = doc || '{\"status\":\"PENDING\"}' where key = $1", [id]), /final/);
    await assert.rejects(() => w.store.pool.query("update outbox set doc = jsonb_set(doc, '{data}', '{\"x\":1}') where key = $1", [id]), /immutable|final/);
    void org;
  } finally { await w.cleanup(); }
});
