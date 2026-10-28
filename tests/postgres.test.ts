import test from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { randomBytes } from "node:crypto";
import { createApp } from "@livecoco/api";
import { PgStore } from "@livecoco/database";
import { hoursFromNow, makeWorld, sampleTerms, type Login, type World } from "@livecoco/test-support";

const URL_ = process.env.DATABASE_URL;
const skip = URL_ ? false : "DATABASE_URL not set (start Postgres with `docker compose up -d db`)";

const lotInput = (w: World, over: Record<string, unknown> = {}) => ({
  productId: "prod_mature_coconut" as const, gradeAttributes: { husk: "WITH_HUSK" }, gradeGroup: "FAQ", unit: "NUT" as const, quantityTotal: "10000", partialFulfilmentAllowed: true,
  originMarketId: "market_anaimalai", availableFrom: "2026-10-02T04:00:00Z", availableTo: "2026-10-06T04:00:00Z", expiresAt: hoursFromNow(w.clock, 72),
  fulfilment: { mode: "PICKUP" as const, costsIncluded: ["LOADING"], costsExcluded: [] }, priceExpectation: { unitPricePaise: 3000 }, photoCount: 1, ...over,
});

/**
 * A fully isolated schema per test. `w` is one "process"; `process()` starts another LiveCoco process with its own
 * connection pool on the same database, which is how several API and worker processes run in production.
 */
async function boot() {
  const schema = `t_${randomBytes(6).toString("hex")}`;
  const stores: PgStore[] = [];
  const pg = () => { const s = new PgStore({ connectionString: URL_ as string, schema }); stores.push(s); return s; };
  const store = pg();
  await store.migrate();
  const w = makeWorld({}, store);
  const q = (sql: string, params: unknown[] = []) => store.pool.query(sql, params);
  /** Another process sharing the clock, OTP inbox and database. */
  const process = () => {
    const other = makeWorld({ clock: w.clock.now, deliverOtp: (p, c) => w.otps.set(p, c) }, pg());
    return other;
  };
  const cleanup = async () => { await q(`drop schema ${schema} cascade`).catch(() => {}); for (const s of stores) await s.close().catch(() => {}); };
  return { schema, store, w, q, process, cleanup };
}

async function verified(w: World, ...who: Login[]) { for (const x of who) await w.verify(x, "PERSON_IDENTITY"); }

test("migrations are idempotent and checksummed", { skip }, async () => {
  const t = await boot();
  try {
    assert.deepEqual(await t.store.migrate(), []);
    const rows = (await t.q("select name from schema_migrations")).rows;
    assert.deepEqual(rows.map((r) => r.name).sort(), ["001_init.sql", "002_release_d.sql", "003_outbox.sql", "004_unit_of_work.sql", "005_price_history_documents.sql"]);
    await t.q("update schema_migrations set checksum = 'tampered'");
    await assert.rejects(() => t.store.migrate(), /modified after being applied/);
  } finally { await t.cleanup(); }
});

test("state is in the database, not the process: a second process sees and continues everything", { skip }, async () => {
  const t = await boot();
  try {
    const { w } = t;
    const seller = await w.login("9600000001"), buyer = await w.login("9600000002");
    await verified(w, seller, buyer);
    const lot = await w.as(seller).lots.activate((await w.as(seller).lots.create(lotInput(w))).sellLotId);
    const offer = await w.as(buyer).offers.create({ sellLotId: lot.sellLotId, terms: sampleTerms({ quantity: "4000" }), expiresAt: hoursFromNow(w.clock, 6) });
    const deal = await w.as(seller).offers.accept(offer.offerId);

    const p2 = t.process();
    assert.equal((await p2.get<{ quantityReserved: string }>("sell_lots", lot.sellLotId))!.quantityReserved, "4000");
    const seen = await p2.as(seller).deals.view(deal.dealId);
    assert.equal(seen.status, "AGREED");
    assert.ok(Object.isFrozen(seen.cards[0]), "immutable history is frozen when loaded");
    assert.equal((await p2.as(seller).identity.me()).userId, seller.user.userId, "sessions are shared by every process");
    assert.ok((await p2.log<{ action: string }>("audit_log")).some((a) => a.action === "OFFER_ACCEPTED"));
    await p2.as(seller).deals.confirmDelivery(deal.dealId);
    assert.equal((await t.q("select status from deals")).rows[0].status, "DELIVERED");
    assert.equal((await w.as(buyer).deals.view(deal.dealId)).status, "DELIVERED", "and the first process sees the second's write");
  } finally { await t.cleanup(); }
});

test("a failing unit of work leaves nothing behind", { skip }, async () => {
  const t = await boot();
  try {
    const { w } = t;
    const u = await w.login("9600000003");
    await assert.rejects(() => w.app.run(async (s) => {
      s.actor = await w.app.services.identity.authenticate(s, u.token);
      await w.app.services.identity.createOrganization(s, "Half done", "TRADER");
      w.app.services.identity.updateProfile(s, { displayName: "mutated" });
      throw new Error("boom");
    }), /boom/);
    assert.equal((await t.q("select count(*)::int n from organizations")).rows[0].n, 0);
    assert.equal((await t.q("select count(*)::int n from audit_log")).rows[0].n, 0);
    assert.equal((await w.as(u).identity.me()).displayName, "");
    await w.as(u).identity.createOrganization("Fine", "TRADER");
    assert.equal((await t.q("select count(*)::int n from organizations")).rows[0].n, 1);
  } finally { await t.cleanup(); }
});

test("failed OTP attempts are committed (brute force protection survives errors and other processes)", { skip }, async () => {
  const t = await boot();
  try {
    const { w } = t;
    await w.sys.identity.requestOtp("9600000004", "dev");
    for (let i = 0; i < 5; i++) await assert.rejects(() => w.sys.identity.verifyOtp("9600000004", "000000", "dev"), /invalid or expired/);
    const real = w.otps.get("+919600000004")!;
    await assert.rejects(() => w.sys.identity.verifyOtp("9600000004", real, "dev"), /invalid or expired/, "locked after 5 wrong attempts");
    await assert.rejects(() => t.process().sys.identity.verifyOtp("9600000004", real, "dev"), /invalid or expired/, "the lock is shared by every process");
  } finally { await t.cleanup(); }
});

test("concurrent acceptances from two processes are serialised on the lot row: exactly one wins, nothing is oversold", { skip }, async () => {
  const t = await boot();
  try {
    const { w } = t;
    const seller = await w.login("9600000010");
    const buyers = await Promise.all([11, 12, 13, 14].map((n) => w.login(`96000000${n}`)));
    await verified(w, seller, ...buyers);
    const lot = await w.as(seller).lots.activate((await w.as(seller).lots.create(lotInput(w, { quantityTotal: "5000", partialFulfilmentAllowed: false }))).sellLotId);
    const offers = [];
    for (const b of buyers) offers.push(await w.as(b).offers.create({ sellLotId: lot.sellLotId, terms: sampleTerms({ quantity: "5000" }), expiresAt: hoursFromNow(w.clock, 6) }));
    const procs = [w, t.process(), t.process(), t.process()];
    const results = await Promise.allSettled(offers.map((o, i) => procs[i]!.as(seller).offers.accept(o.offerId)));
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1, JSON.stringify(results.map((r) => r.status === "rejected" ? String(r.reason) : "ok")));
    assert.ok(results.every((r) => r.status === "fulfilled" || /reserved this quantity|not active|INVALIDATED/i.test(String(r.reason))));
    assert.equal((await t.q("select count(*)::int n from deals")).rows[0].n, 1);
    assert.equal((await t.q("select quantity_reserved::text q from sell_lots")).rows[0].q, "5000");
  } finally { await t.cleanup(); }
});

test("concurrent retries of one idempotent request across processes execute it once", { skip }, async () => {
  const t = await boot();
  try {
    const { w } = t;
    const u = await w.login("9600000030");
    const procs = [w, t.process(), t.process()];
    const servers = await Promise.all(procs.map(async (p) => { const srv = await createApp({ app: p.app }); await new Promise<void>((r) => srv.listen(0, r)); return srv; }));
    try {
      const post = (srv: (typeof servers)[number]) => fetch(`http://127.0.0.1:${(srv.address() as AddressInfo).port}/v1/organizations`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${u.token}`, "idempotency-key": "same" }, body: JSON.stringify({ name: "Once", kind: "FPO" }) });
      const res = await Promise.all(servers.map(post));
      const bodies = await Promise.all(res.map((r) => r.json()));
      assert.deepEqual(res.map((r) => r.status), [201, 201, 201]);
      assert.equal(new Set(bodies.map((b) => (b as { organizationId: string }).organizationId)).size, 1, "every retry returns the one outcome");
      assert.equal((await t.q("select count(*)::int n from organizations")).rows[0].n, 1);
    } finally { for (const s of servers) s.close(); }
  } finally { await t.cleanup(); }
});

test("HTTP API on Postgres: durable, and a restarted process replays idempotent requests", { skip }, async () => {
  const t = await boot();
  const { w } = t;
  const srv = await createApp({ app: w.app });
  await new Promise<void>((r) => srv.listen(0, r));
  const at = (s: typeof srv) => `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
  const call = async (base: string, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => { const r = await fetch(base + path, { method, headers: { "content-type": "application/json", ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) }); return { status: r.status, json: (await r.json()) as any }; };
  try {
    await call(at(srv), "POST", "/v1/auth/otp/request", { phone: "9600000020" });
    const v = await call(at(srv), "POST", "/v1/auth/otp/verify", { phone: "9600000020", code: w.otps.get("+919600000020") });
    const h = { authorization: `Bearer ${v.json.token}` };
    const a = await call(at(srv), "POST", "/v1/organizations", { name: "Durable FPO", kind: "FPO" }, { ...h, "idempotency-key": "k" });
    assert.equal(a.status, 201);
    assert.equal((await call(at(srv), "POST", "/v1/organizations", { name: "Bad", kind: "NOPE" }, { ...h, "idempotency-key": "k2" })).status, 422);
    srv.close();
    const srv2 = await createApp({ app: t.process().app });
    await new Promise<void>((r) => srv2.listen(0, r));
    try {
      const again = await call(at(srv2), "POST", "/v1/organizations", { name: "Durable FPO", kind: "FPO" }, { ...h, "idempotency-key": "k" });
      assert.deepEqual(again.json, a.json);
      assert.equal((await t.q("select count(*)::int n from organizations")).rows[0].n, 1);
      assert.equal((await call(at(srv2), "GET", "/v1/me", undefined, h)).status, 200, "session valid in the new process");
    } finally { srv2.close(); }
  } finally { srv.close(); await t.cleanup(); }
});

test("database enforces integrity independently of the application", { skip }, async () => {
  const t = await boot();
  try {
    const u = await t.w.login("9600000005");
    const q = t.q;
    // append-only log
    await q("insert into audit_log (doc) values ('{}')");
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
    const deal = { sellerId: "s", buyerId: "b", sellLotId: "l1", status: "AGREED", cards: [{ revision: 1, totalPaise: 10 }], events: [{ seq: 1 }] };
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
    // concurrent duplicate notifications collapse into one
    await q("insert into notifications (doc) values ('{\"userId\":\"u\",\"dedupeKey\":\"k\"}')");
    await assert.rejects(() => q("insert into notifications (doc) values ('{\"userId\":\"u\",\"dedupeKey\":\"k\"}')"), /notifications_dedupe_uq/);
  } finally { await t.cleanup(); }
});

test("Release D integrity: settlements balance, one booked quote, immutable inspection results and aggregates", { skip }, async () => {
  const t = await boot();
  try {
    const q = t.q;
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
  } finally { await t.cleanup(); }
});

test("Release D end to end on Postgres: settlement is stored balanced and readable from another process", { skip }, async () => {
  const t = await boot();
  try {
    const { w } = t;
    const mgr = await w.login("9610000001"), fin = await w.login("9610000002"), buyer = await w.login("9610000003");
    await w.verify(mgr, "ORGANIZATION_EXISTENCE"); await w.verify(buyer, "PERSON_IDENTITY");
    const org = await w.as(mgr).identity.createOrganization("FPO", "FPO");
    await w.sys.identity.requestOtp(mgr.user.phone, "step");
    await w.as(mgr).identity.stepUp(w.otps.get(mgr.user.phone)!);
    await w.as(mgr).identity.addMember(org.organizationId, fin.user.userId, "OWNER");
    const lots = [];
    for (const [n, q] of [["Ravi", "6000"], ["Meena", "4000"]] as const) lots.push(await w.as(mgr).fpo.addMemberLot(org.organizationId, { memberName: n, productId: "prod_mature_coconut", gradeGroup: "FAQ", unit: "NUT", quantity: q, originMarketId: "market_pollachi", quality: { husk: "W" } }));
    for (const l of lots) await w.as(fin).fpo.reviewMemberLot(l.memberLotId, true);
    const { sellLot } = await w.as(mgr).fpo.buildAggregate(org.organizationId, { memberLotIds: lots.map((l) => l.memberLotId), availableFrom: "2026-10-02T04:00:00Z", availableTo: "2026-10-09T04:00:00Z", expiresAt: hoursFromNow(w.clock, 100), fulfilment: { mode: "PICKUP", costsIncluded: ["X"], costsExcluded: [] }, priceExpectation: { inviteOffers: true } });
    await w.as(mgr).lots.addPhoto(sellLot.sellLotId);
    await w.as(mgr).lots.activate(sellLot.sellLotId);
    const offer = await w.as(buyer).offers.create({ sellLotId: sellLot.sellLotId, terms: sampleTerms({ quantity: "10000", unitPricePaise: 3001 }), expiresAt: hoursFromNow(w.clock, 6) });
    const deal = await w.as(mgr).offers.accept(offer.offerId);
    await w.as(mgr).deals.confirmDelivery(deal.dealId);
    await w.as(buyer).deals.acceptDelivery(deal.dealId);
    const s = await w.as(mgr).fpo.draftSettlement(deal.dealId, [{ type: "COMMISSION", amountPaise: 33_333 }]);
    const row = (await t.q("select gross_paise::int g, deduction_total_paise::int d, net_paise::int n, status from settlements")).rows[0];
    assert.deepEqual([row.g, row.d, row.n, row.status], [30_010_000, 33_333, 30_010_000 - 33_333, "DRAFT"]);
    await w.as(fin).fpo.approveSettlement(s.settlementId);
    const p2 = t.process();
    const loaded = await p2.as(fin).fpo.settlement(s.settlementId);
    assert.equal(loaded.status, "APPROVED");
    assert.equal(loaded.lines.reduce((a, l) => a + l.netPaise, 0), loaded.netPaise);
    assert.match(await p2.as(fin).fpo.exportSettlementCsv(s.settlementId), /Ravi/);
  } finally { await t.cleanup(); }
});

test("outbox rows commit atomically with the state change and vanish on rollback", { skip }, async () => {
  const t = await boot();
  try {
    const { w } = t;
    const b = await w.login("9620000002");
    const count = async () => (await t.q("select count(*)::int n from outbox")).rows[0].n as number;
    const before = await count();
    await assert.rejects(() => w.run(async (s) => { await w.app.services.notifier.notify(s, b.user.userId, "SMS", "claim.approved", {}, "k1"); throw new Error("boom"); }), /boom/);
    assert.equal(await count(), before, "rolled back with the failed unit of work");
    assert.equal(await w.sys.notifier.notify(b.user.userId, "SMS", "claim.approved", {}, "k1"), true);
    assert.equal(await count(), before + 1);
    const id = (await t.q("select key from outbox where doc->>'template' = 'claim.approved'")).rows[0].key as string;
    // two workers never lease the same message
    const [x, y] = await Promise.all([w.sys.notifier.claim(5), t.process().sys.notifier.claim(5)]);
    assert.equal([...x, ...y].filter((m) => m.notificationId === id).length, 1);
    await w.sys.notifier.ack(id, true);
    await assert.rejects(() => t.q("update outbox set doc = doc || '{\"status\":\"PENDING\"}' where key = $1", [id]), /final/);
    await assert.rejects(() => t.q("update outbox set doc = jsonb_set(doc, '{data}', '{\"x\":1}') where key = $1", [id]), /immutable|final/);
  } finally { await t.cleanup(); }
});
