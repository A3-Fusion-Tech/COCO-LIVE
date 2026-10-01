import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { PERSISTED_COLLECTIONS, SqliteStore } from "../packages/database/src/index.ts";
import { Platform } from "../apps/api/src/platform.ts";
import { createApp } from "../apps/api/src/server.ts";
import { AgmarknetAdapter, type FetchLike } from "../apps/worker/src/agmarknet.ts";
import { runAgmarknetIngest } from "../apps/worker/src/jobs.ts";
import { FakeClock } from "../packages/test-support/src/index.ts";

const row = (market: string) => ({ state: "Tamil Nadu", district: "Coimbatore", market, commodity: "Coconut", variety: "Other", grade: "FAQ", arrival_date: "01/10/2026", min_price: "2900", max_price: "3200", modal_price: "3050", price_unit: "Rs./Quintal" });

function tempDb() {
  const dir = mkdtempSync(join(tmpdir(), "livecoco-"));
  return { path: join(dir, "state.sqlite"), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/** One "process": its own Platform and its own connection to the shared database file. */
function proc(path: string, clock: FakeClock, otps = new Map<string, string>()) {
  const p = new Platform({ clock: clock.now, deliverOtp: (ph, c) => otps.set(ph, c) });
  const store = new SqliteStore(path);
  store.attach(p);
  return { p, store, otps, atomic: <T>(fn: () => T): T => store.unitOfWork(p, fn) };
}

test("every Map or array on Platform is persisted", () => {
  const p = new Platform();
  const fields = Object.entries(p).filter(([, v]) => v instanceof Map || Array.isArray(v)).map(([k]) => k).sort();
  assert.deepEqual(fields, Object.keys(PERSISTED_COLLECTIONS).sort(), "a new collection must be added to PERSISTED_COLLECTIONS");
});

test("prices ingested by the worker are visible to the API process", async () => {
  const db = tempDb();
  const clock = new FakeClock();
  const worker = proc(db.path, clock);
  const api = proc(db.path, clock);
  try {
    const ok: FetchLike = async () => ({ status: 200, json: async () => ({ records: [row("Pollachi"), row("Anaimalai")] }) });
    const out = await runAgmarknetIngest(worker.p, new AgmarknetAdapter({ apiKey: "k", resourceId: "r" }, ok), 20, worker.atomic);
    assert.equal(out.observations, 2);
    assert.equal(api.p.observations.size, 0, "API memory is stale until its next unit of work");
    const seen = api.atomic(() => api.p.observations.size);
    assert.equal(seen, 2);
    assert.deepEqual(api.atomic(() => api.p.latestPrices()), worker.atomic(() => worker.p.latestPrices()));
  } finally { worker.store.close(); api.store.close(); db.cleanup(); }
});

test("state survives a restart, keeps first-run defaults and writes only changed rows", () => {
  const db = tempDb();
  const clock = new FakeClock();
  const first = proc(db.path, clock);
  const msp = structuredClone(first.p.msp);
  const token = first.atomic(() => {
    first.p.requestOtp("9300000001", "web");
    return first.p.verifyOtp("9300000001", first.otps.get("+919300000001") as string, "web").token;
  });
  assert.equal(first.store.save(first.p), 0, "nothing changed since the last commit");
  first.store.close();

  const restarted = proc(db.path, clock);
  try {
    assert.deepEqual(restarted.p.msp, msp, "default MSP reference written on first run and reloaded");
    const { user } = restarted.atomic(() => restarted.p.authenticate(token));
    assert.equal(user.phone, "+919300000001");
  } finally { restarted.store.close(); db.cleanup(); }
});

test("state changed by a failing operation is still committed (failed OTP attempts stay counted)", () => {
  const db = tempDb();
  const clock = new FakeClock();
  const a = proc(db.path, clock);
  try {
    a.atomic(() => a.p.requestOtp("9300000001", "web"));
    assert.throws(() => a.atomic(() => a.p.verifyOtp("9300000001", "000000", "web")));
    const b = proc(db.path, clock);
    const attempts = [...b.p.otps.values()].map((o) => (o as { attempts: number }).attempts);
    assert.deepEqual(attempts, [1]);
    b.store.close();
  } finally { a.store.close(); db.cleanup(); }
});

test("HTTP requests run as durable units of work", async () => {
  const db = tempDb();
  const clock = new FakeClock();
  const a = proc(db.path, clock);
  const srv = createApp({ platform: a.p, atomic: a.atomic });
  await new Promise<void>((r) => srv.listen(0, r));
  const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  const post = (path: string, body: unknown) => fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, json: (await r.json()) as any }));
  try {
    assert.equal((await post("/v1/auth/otp/request", { phone: "9300000001" })).status, 200);
    const ok = await post("/v1/auth/otp/verify", { phone: "9300000001", code: a.otps.get("+919300000001") });
    assert.equal(ok.status, 200);
    const other = proc(db.path, clock);
    assert.equal(other.atomic(() => other.p.authenticate(ok.json.token)).user.phone, "+919300000001");
    other.store.close();
  } finally { srv.close(); a.store.close(); db.cleanup(); }
});
