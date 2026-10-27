import test from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { PriceObservation } from "@livecoco/domain";
import { AgmarknetAdapter, type FetchLike } from "../apps/worker/src/agmarknet.ts";
import { appSink, runAgmarknetIngest } from "../apps/worker/src/jobs.ts";
import { makeWorld } from "@livecoco/test-support";

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
  const observations = async () => (await w.find<PriceObservation>("price_observations")).length;
  const ok: FetchLike = async () => ({ status: 200, json: async () => ({ records: [row("Pollachi"), row("Anaimalai"), row("Narnia")] }) });
  const adapter = new AgmarknetAdapter({ apiKey: "k", resourceId: "r" }, ok);
  const first = await runAgmarknetIngest(appSink(w.app), adapter);
  assert.deepEqual([first.ok, first.stored, first.observations, first.unmapped], [true, 3, 2, 1]);
  const second = await runAgmarknetIngest(appSink(w.app), adapter);
  assert.deepEqual([second.stored, second.duplicates], [0, 3]);
  assert.equal(await observations(), 2);

  const broken = new AgmarknetAdapter({ apiKey: "k", resourceId: "r", maxRetries: 0, sleep: async () => {} }, async () => ({ status: 500, json: async () => ({}) }));
  const out = await runAgmarknetIngest(appSink(w.app), broken);
  assert.equal(out.ok, false);
  assert.equal(await w.sys.prices.sourceStatus("agmarknet"), "DELAYED");
  assert.equal(await observations(), 2, "last-known values kept");
  const tick = await appSink(w.app).tick();
  assert.equal(tick.deemedAcceptances, 0);
});

test("the worker's sink works directly against the services: ingest, tick and failures", async () => {
  const w = makeWorld();
  const sink = appSink(w.app);
  const r = await sink.ingest("agmarknet", [row("Pollachi")]);
  assert.equal(r.observations, 1);
  assert.equal((await w.find<PriceObservation>("price_observations")).length, 1);
  assert.equal(await w.sys.prices.sourceStatus("agmarknet"), "HEALTHY");
  assert.equal((await sink.tick()).deemedAcceptances, 0);
  await sink.failure("agmarknet", "GET https://x?api-key=SECRET failed");
  assert.equal(await w.sys.prices.sourceStatus("agmarknet"), "DELAYED");
  const health = await w.get<{ lastError: string }>("source_health", "agmarknet");
  assert.equal(health!.lastError.includes("SECRET"), false, "credentials are redacted");
  assert.equal((await w.find<PriceObservation>("price_observations")).length, 1, "a failure never erases data");
});

test("the API no longer exposes internal worker endpoints, to anyone", async () => {
  const { createApp } = await import("../apps/api/src/server.ts");
  const w = makeWorld();
  const srv = await createApp({ app: w.app });
  await new Promise<void>((r) => srv.listen(0, r));
  const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  try {
    const user = await w.login("9500000001");
    const ops = await w.operator();
    for (const headers of [{}, { "x-internal-token": "s3cret-service-token" }, { authorization: "Bearer s3cret-service-token" }, { authorization: `Bearer ${user.token}` }, { authorization: `Bearer ${ops.token}` }]) {
      for (const path of ["/v1/internal/tick", "/v1/internal/ingest", "/v1/internal/source-failure"]) {
        const res = await fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: "{}" });
        assert.equal(res.status, 404, `${path} with ${Object.keys(headers).join(",") || "no auth"}`);
      }
    }
  } finally { srv.close(); }
});
