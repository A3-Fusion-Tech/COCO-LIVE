import test from "node:test";
import assert from "node:assert/strict";
import { hoursFromNow, makeWorld, sampleTerms } from "../packages/test-support/src/index.ts";
import { deliverOutbox, consoleProvider, disabledProvider, type OutboxClient } from "../apps/worker/src/jobs.ts";
import { renderNotification } from "../packages/localization/src/index.ts";

function client(w: ReturnType<typeof makeWorld>): OutboxClient {
  return { claim: async (n) => w.p.claimOutbox(n) as never, ack: async (id, ok, e) => void w.p.ackOutbox(id, ok, e) };
}
function withOffer() {
  const w = makeWorld();
  const seller = w.login("9900000001"), buyer = w.login("9900000002");
  w.verify(seller.user, "PERSON_IDENTITY"); w.verify(buyer.user, "PERSON_IDENTITY");
  const lot = w.p.createLot(seller.user, { productId: "prod_mature_coconut", gradeAttributes: { husk: "W" }, gradeGroup: "FAQ", unit: "NUT", quantityTotal: "1000", partialFulfilmentAllowed: true, originMarketId: "market_pollachi", availableFrom: "2026-10-02T04:00:00Z", availableTo: "2026-10-06T04:00:00Z", expiresAt: hoursFromNow(w.clock, 72), fulfilment: { mode: "PICKUP", costsIncluded: ["X"], costsExcluded: [] }, priceExpectation: { inviteOffers: true }, photoCount: 1 });
  w.p.activateLot(seller.user, lot.sellLotId);
  w.p.createOffer(buyer.user, { sellLotId: lot.sellLotId, terms: sampleTerms({ quantity: "100" }), expiresAt: hoursFromNow(w.clock, 6) });
  return { w, seller, buyer };
}

test("state changes enqueue outbox items; delivery is at-least-once with leases, retry/backoff and dead-lettering", async () => {
  const { w, seller } = withOffer();
  const pending = [...w.p.outbox.values()].filter((o) => o.template === "offer.received");
  assert.equal(pending.length, 1);
  assert.equal(pending[0]!.userId, seller.user.userId);

  const lines: string[] = [];
  const sms = consoleProvider((l) => lines.push(l));
  const r = await deliverOutbox(client(w), { SMS: sms }, (m) => renderNotification(m.locale, m.template, m.data));
  assert.equal(r.sent >= 1, true);
  assert.ok(lines.some((l) => l.includes("புதிய சலுகை")), "recipient locale (Tamil) is used");
  assert.equal(JSON.stringify(lines).includes(seller.user.phone), false, "phone numbers are masked in logs");
  assert.equal(pending[0]!.status, "SENT");
  assert.equal((await deliverOutbox(client(w), { SMS: sms }, () => "")).sent, 0, "sent items are not re-sent");

  // failure → backoff → dead letter + operator risk item
  w.p.notify(seller.user.userId, "SMS", "claim.approved", {}, "k-fail");
  const id = [...w.p.outbox.values()].find((o) => o.template === "claim.approved" && o.status === "PENDING" && o.attempts === 0 && o.userId === seller.user.userId && !o.data.type)!.notificationId;
  for (let i = 1; i <= 5; i++) {
    const out = await deliverOutbox(client(w), { SMS: disabledProvider }, () => "x");
    assert.equal(out.failed, 1, `attempt ${i}`);
    const o = w.p.outbox.get(id)!;
    if (i < 5) { assert.equal(o.status, "PENDING"); assert.equal((await deliverOutbox(client(w), { SMS: disabledProvider }, () => "x")).failed, 0, "not due before backoff elapses"); w.clock.advanceMinutes(2 ** i + 1); }
  }
  assert.equal(w.p.outbox.get(id)!.status, "DEAD");
  assert.ok([...w.p.queue.values()].some((q) => q.reasons.includes("DELIVERY_DEAD")));
  w.p.ackOutbox(id, true);
  assert.equal(w.p.outbox.get(id)!.status, "DEAD", "dead items stay dead");
});

test("an expired lease is retried (crash safety) and notifications are de-duplicated", () => {
  const { w, seller } = withOffer();
  assert.equal(w.p.claimOutbox(10).length >= 1, true);
  assert.equal(w.p.claimOutbox(10).length, 0, "leased items are not handed out twice");
  w.clock.advanceMinutes(6);
  assert.equal(w.p.claimOutbox(10).length >= 1, true, "lease expired → redelivered");
  const before = w.p.outbox.size;
  assert.equal(w.p.notify(seller.user.userId, "SMS", "x", {}, "same"), true);
  assert.equal(w.p.notify(seller.user.userId, "SMS", "x", {}, "same"), false);
  assert.equal(w.p.outbox.size, before + 1);
});

test("notifications render in Tamil and English with formatted values", () => {
  const data = { referencePaise: 305000, observedAt: "2026-10-01T04:30:00Z", link: "/prices/x" };
  assert.match(renderNotification("en", "price.alert", data), /₹3,050/);
  assert.match(renderNotification("ta", "price.alert", data), /எச்சரிக்கை/);
  assert.equal(renderNotification("en", "dispute.opened", {}), "LiveCoco: a dispute was opened on your deal. Please respond before {dueAt}.");
});
