import test from "node:test";
import assert from "node:assert/strict";
import { AgmarknetAdapter, type FetchLike } from "../apps/worker/src/agmarknet.ts";
import { runAgmarknetIngest, runMaintenanceTick } from "../apps/worker/src/jobs.ts";
import { makeWorld } from "../packages/test-support/src/index.ts";

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
  const first = await runAgmarknetIngest(w.p, adapter);
  assert.deepEqual([first.ok, first.stored, first.observations, first.unmapped], [true, 3, 2, 1]);
  const second = await runAgmarknetIngest(w.p, adapter);
  assert.deepEqual([second.stored, second.duplicates], [0, 3]);
  assert.equal(w.p.observations.size, 2);

  const broken = new AgmarknetAdapter({ apiKey: "k", resourceId: "r", maxRetries: 0, sleep: async () => {} }, async () => ({ status: 500, json: async () => ({}) }));
  const out = await runAgmarknetIngest(w.p, broken);
  assert.equal(out.ok, false);
  assert.equal(w.p.sourceStatus("agmarknet"), "DELAYED");
  assert.equal(w.p.observations.size, 2, "last-known values kept");
  const tick = runMaintenanceTick(w.p);
  assert.equal(tick.deemedAcceptances, 0);
});
