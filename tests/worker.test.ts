import test from "node:test";
import assert from "node:assert/strict";
import { AgmarknetAdapter, type FetchLike } from "../apps/worker/src/agmarknet.ts";
import { HttpSink, runAgmarknetIngest } from "../apps/worker/src/jobs.ts";
import { localSink, makeWorld } from "@livecoco/test-support";

const row = (market: string, commodity = "Coconut") => ({ state: "Tamil Nadu", district: "Coimbatore", market, commodity, variety: "Other", grade: "FAQ", arrival_date: "01/10/2026", min_price: "2900", max_price: "3200", modal_price: "3050", price_unit: "Rs./Quintal" });

test("adapter filters defensively, paginates, retries with jitter and redacts credentials", async () => {
  const calls: string[] = [];
  let failures = 2;
  const fetchImpl: FetchLike = async (url) => {
    calls.push(url);
    if (failures-- > 0) return { status: 503, json: async () => ({}) };
    return { status: 200, json: async () => ({ records: [row("Pollachi"), { ...row("Pune"), state: "Maharashtra" }, row("Pollachi", "Onion")] }) };
  };
  const sleeps: number[] = [];
  const a = new AgmarknetAdapter({ apiKey: "SECRETKEY", resourceId: "rid", pageSize: 100, sleep: async (ms) => void sleeps.push(ms), random: () => 0.5 }, fetchImpl);
  const batch = await a.fetch(0);
  assert.equal(batch.records.length, 1);
  assert.equal(batch.nextOffset, null);
  assert.equal(sleeps.length, 2);
  assert.ok(sleeps[1]! > sleeps[0]!);
  assert.equal(a.identify(row("Pollachi")), a.identify(row("Pollachi")));

  const dead = new AgmarknetAdapter({ apiKey: "SECRETKEY", resourceId: "rid", maxRetries: 1, sleep: async () => {} }, async () => { throw new Error("boom https://x?api-key=SECRETKEY"); });
  await assert.rejects(() => dead.fetch(0), (e: Error) => !e.message.includes("SECRETKEY"));
  const fatal = new AgmarknetAdapter({ apiKey: "k", resourceId: "r", sleep: async () => {} }, async () => ({ status: 401, json: async () => ({}) }));
  await assert.rejects(() => fatal.fetch(0), /401/);
});

test("ingest job is replay-safe, and outages degrade health without erasing data", async () => {
  const w = makeWorld();
  const ok: FetchLike = async () => ({ status: 200, json: async () => ({ records: [row("Pollachi"), row("Anaimalai"), row("Narnia")] }) });
  const adapter = new AgmarknetAdapter({ apiKey: "k", resourceId: "r" }, ok);
  const first = await runAgmarknetIngest(localSink(w.p), adapter);
  assert.deepEqual([first.ok, first.stored, first.observations, first.unmapped], [true, 3, 2, 1]);
  const second = await runAgmarknetIngest(localSink(w.p), adapter);
  assert.deepEqual([second.stored, second.duplicates], [0, 3]);
  assert.equal(w.p.observations.size, 2);

  const broken = new AgmarknetAdapter({ apiKey: "k", resourceId: "r", maxRetries: 0, sleep: async () => {} }, async () => ({ status: 500, json: async () => ({}) }));
  const out = await runAgmarknetIngest(localSink(w.p), broken);
  assert.equal(out.ok, false);
  assert.equal(w.p.sourceStatus("agmarknet"), "DELAYED");
  assert.equal(w.p.observations.size, 2, "last-known values kept");
  const tick = await localSink(w.p).tick();
  assert.equal(tick.deemedAcceptances, 0);
});

test("HTTP sink talks to the internal API with a service token; user sessions cannot", async () => {
  const { createApp } = await import("../apps/api/src/server.ts");
  const w = makeWorld();
  const srv = await createApp({ platform: w.p, internalToken: "s3cret-service-token" });
  await new Promise<void>((r) => srv.listen(0, r));
  const base = `http://127.0.0.1:${(srv.address() as import("node:net").AddressInfo).port}`;
  try {
    const sink = new HttpSink(base, "s3cret-service-token");
    const r = await sink.ingest("agmarknet", [row("Pollachi")]);
    assert.equal(r.observations, 1);
    assert.equal(w.p.observations.size, 1);
    assert.equal((await sink.tick()).deemedAcceptances, 0);
    await sink.failure("agmarknet", "x");
    assert.equal(w.p.sourceStatus("agmarknet"), "DELAYED");
    const bad = new HttpSink(base, "wrong");
    await assert.rejects(() => bad.tick(), /404/);
    const user = w.login("9500000001");
    const res = await fetch(`${base}/v1/internal/tick`, { method: "POST", headers: { authorization: `Bearer ${user.token}` }, body: "{}" });
    assert.equal(res.status, 404);
  } finally { srv.close(); }
  const off = await createApp({ platform: makeWorld().p });
  await new Promise<void>((r) => off.listen(0, r));
  try { assert.equal((await fetch(`http://127.0.0.1:${(off.address() as import("node:net").AddressInfo).port}/v1/internal/tick`, { method: "POST", body: "{}", headers: { "x-internal-token": "" } })).status, 404, "disabled without a configured token"); } finally { off.close(); }
});
