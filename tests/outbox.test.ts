import test from "node:test";
import assert from "node:assert/strict";
import { hoursFromNow, makeWorld, sampleTerms, type World } from "@livecoco/test-support";
import { appOutbox, deliverOutbox, consoleProvider, disabledProvider } from "../apps/worker/src/jobs.ts";
import { renderNotification } from "@livecoco/localization";

interface OutboxItem { notificationId: string; userId: string; template: string; status: string; attempts: number; data: Record<string, unknown> }
const outbox = (w: World, match: Record<string, unknown> = {}) => w.find<OutboxItem>("outbox", match);
const item = async (w: World, id: string) => (await w.get<OutboxItem>("outbox", id))!;

async function withOffer() {
  const w = makeWorld();
  const seller = await w.login("9900000001"), buyer = await w.login("9900000002");
  await w.verify(seller, "PERSON_IDENTITY"); await w.verify(buyer, "PERSON_IDENTITY");
  const lot = await w.as(seller).lots.create({ productId: "prod_mature_coconut", gradeAttributes: { husk: "W" }, gradeGroup: "FAQ", unit: "NUT", quantityTotal: "1000", partialFulfilmentAllowed: true, originMarketId: "market_pollachi", availableFrom: "2026-10-02T04:00:00Z", availableTo: "2026-10-06T04:00:00Z", expiresAt: hoursFromNow(w.clock, 72), fulfilment: { mode: "PICKUP", costsIncluded: ["X"], costsExcluded: [] }, priceExpectation: { inviteOffers: true }, photoCount: 1 });
  await w.as(seller).lots.activate(lot.sellLotId);
  await w.as(buyer).offers.create({ sellLotId: lot.sellLotId, terms: sampleTerms({ quantity: "100" }), expiresAt: hoursFromNow(w.clock, 6) });
  return { w, seller, buyer };
}

test("state changes enqueue outbox items; delivery is at-least-once with leases, retry/backoff and dead-lettering", async () => {
  const { w, seller } = await withOffer();
  const client = appOutbox(w.app);
  const pending = await outbox(w, { template: "offer.received" });
  assert.equal(pending.length, 1);
  assert.equal(pending[0]!.userId, seller.user.userId);

  const lines: string[] = [];
  const sms = consoleProvider((l) => lines.push(l));
  const r = await deliverOutbox(client, { SMS: sms }, (m) => renderNotification(m.locale, m.template, m.data));
  assert.equal(r.sent >= 1, true);
  assert.ok(lines.some((l) => l.includes("புதிய சலுகை")), "recipient locale (Tamil) is used");
  assert.equal(JSON.stringify(lines).includes(seller.user.phone), false, "phone numbers are masked in logs");
  assert.equal((await item(w, pending[0]!.notificationId)).status, "SENT");
  assert.equal((await deliverOutbox(client, { SMS: sms }, () => "")).sent, 0, "sent items are not re-sent");

  // failure → backoff → dead letter + operator risk item
  await w.sys.notifier.notify(seller.user.userId, "SMS", "claim.approved", {}, "k-fail");
  const id = (await outbox(w, { template: "claim.approved", status: "PENDING", attempts: 0, userId: seller.user.userId })).find((o) => !o.data.type)!.notificationId;
  for (let i = 1; i <= 5; i++) {
    const out = await deliverOutbox(client, { SMS: disabledProvider }, () => "x");
    assert.equal(out.failed, 1, `attempt ${i}`);
    const o = await item(w, id);
    if (i < 5) { assert.equal(o.status, "PENDING"); assert.equal((await deliverOutbox(client, { SMS: disabledProvider }, () => "x")).failed, 0, "not due before backoff elapses"); w.clock.advanceMinutes(2 ** i + 1); }
  }
  assert.equal((await item(w, id)).status, "DEAD");
  assert.ok((await w.find<{ reasons: string[] }>("ops_queue")).some((q) => q.reasons.includes("DELIVERY_DEAD")));
  await client.ack(id, true);
  assert.equal((await item(w, id)).status, "DEAD", "dead items stay dead");
});

test("an expired lease is retried (crash safety) and notifications are de-duplicated", async () => {
  const { w, seller } = await withOffer();
  assert.equal((await w.sys.notifier.claim(10)).length >= 1, true);
  assert.equal((await w.sys.notifier.claim(10)).length, 0, "leased items are not handed out twice");
  w.clock.advanceMinutes(6);
  assert.equal((await w.sys.notifier.claim(10)).length >= 1, true, "lease expired → redelivered");
  const before = (await outbox(w)).length;
  assert.equal(await w.sys.notifier.notify(seller.user.userId, "SMS", "x", {}, "same"), true);
  assert.equal(await w.sys.notifier.notify(seller.user.userId, "SMS", "x", {}, "same"), false);
  assert.equal((await outbox(w)).length, before + 1);
});

test("notifications render in Tamil and English with formatted values", () => {
  const data = { referencePaise: 305000, observedAt: "2026-10-01T04:30:00Z", link: "/prices/x" };
  assert.match(renderNotification("en", "price.alert", data), /₹3,050/);
  assert.match(renderNotification("ta", "price.alert", data), /எச்சரிக்கை/);
  assert.equal(renderNotification("en", "dispute.opened", {}), "LiveCoco: a dispute was opened on your deal. Please respond before {dueAt}.");
});
