import { notFound } from "@livecoco/domain";
import { uid } from "./ids.ts";
import { C, L } from "./collections.ts";
import type { Scope } from "./scope.ts";
import type { WorkQueue } from "./audit.ts";
import type { User } from "../modules/identity/identity.types.ts";

export interface Notification { notificationId: string; userId: string; channel: string; template: string; data: Record<string, unknown>; dedupeKey: string; at: string }
export interface OutboxItem { notificationId: string; userId: string; channel: string; template: string; data: Record<string, unknown>; status: "PENDING" | "LEASED" | "SENT" | "DEAD"; attempts: number; nextAttemptAt: string; leaseUntil: string | undefined; lastError: string | undefined; sentAt: string | undefined; createdAt: string }
export interface OutboxMessage { notificationId: string; to: string | null; locale: "en" | "ta"; channel: string; template: string; data: Record<string, unknown>; attempt: number }

const LEASE_MS = 5 * 60_000;
const MAX_ATTEMPTS = 5;

/**
 * Notifications go through a transactional outbox (ADR-004): the message is written in the same unit of work as
 * the state change that caused it, and the worker delivers it later with at-least-once semantics.
 */
export class Notifier {
  private readonly queue: WorkQueue;
  constructor(queue: WorkQueue) { this.queue = queue; }

  /** Returns false when a notification with the same dedupe key was already queued for this user. */
  async notify(s: Scope, userId: string, channel: string, template: string, data: Record<string, unknown>, dedupeKey: string) {
    if ((await s.tx.findLog(L.notifications, { userId, dedupeKey })).length) return false;
    const n: Notification = { notificationId: uid("n"), userId, channel, template, data, dedupeKey, at: s.iso() };
    s.tx.append(L.notifications, { ...n });
    s.tx.put(C.outbox, n.notificationId, { notificationId: n.notificationId, userId, channel, template, data, status: "PENDING", attempts: 0, nextAttemptAt: n.at, leaseUntil: undefined, lastError: undefined, sentAt: undefined, createdAt: n.at } satisfies OutboxItem);
    return true;
  }

  sent(s: Scope, userId?: string) { return s.tx.findLog<Notification>(L.notifications, userId ? { userId } : {}); }

  /** Leases due messages (pending, or leased but abandoned) to one worker. */
  async claim(s: Scope, limit = 20): Promise<OutboxMessage[]> {
    const now = s.ms();
    const candidates = [...(await s.tx.find<OutboxItem>(C.outbox, { status: "PENDING" })), ...(await s.tx.find<OutboxItem>(C.outbox, { status: "LEASED" }))];
    const due = candidates
      .filter((o) => (o.status === "PENDING" && Date.parse(o.nextAttemptAt) <= now) || (o.status === "LEASED" && o.leaseUntil !== undefined && Date.parse(o.leaseUntil) <= now))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.notificationId.localeCompare(b.notificationId))
      .slice(0, Math.min(limit, 100));
    const out: OutboxMessage[] = [];
    for (const o of due) {
      s.tx.put(C.outbox, o.notificationId, { ...o, status: "LEASED", leaseUntil: new Date(now + LEASE_MS).toISOString() });
      const u = await s.tx.get<User>(C.users, o.userId);
      out.push({ notificationId: o.notificationId, to: u?.phone ?? null, locale: u?.locale ?? "ta", channel: o.channel, template: o.template, data: o.data, attempt: o.attempts + 1 });
    }
    return out;
  }

  /** Records a delivery attempt. Duplicate acks are harmless; failures back off exponentially, then go dead. */
  async ack(s: Scope, notificationId: string, ok: boolean, error = "") {
    const o = await s.tx.get<OutboxItem>(C.outbox, notificationId);
    if (!o) throw notFound("Outbox item");
    if (o.status === "SENT" || o.status === "DEAD") return o;
    if (ok) return s.tx.put(C.outbox, o.notificationId, { ...o, status: "SENT", sentAt: s.iso(), leaseUntil: undefined });
    const attempts = o.attempts + 1;
    const next: OutboxItem = { ...o, attempts, lastError: error.slice(0, 200), leaseUntil: undefined };
    if (attempts >= MAX_ATTEMPTS) {
      next.status = "DEAD";
      this.queue.enqueue(s, { queue: "RISK", subject: notificationId, summary: "Notification delivery failed permanently", reasons: ["DELIVERY_DEAD"], priority: 3, requiredCapability: "ops.source_health" });
    } else {
      next.status = "PENDING";
      next.nextAttemptAt = new Date(s.ms() + 2 ** attempts * 60_000).toISOString();
    }
    return s.tx.put(C.outbox, o.notificationId, next);
  }

  /** Retention: delivered messages older than 30 days. */
  async purgeDelivered(s: Scope) {
    for (const o of await s.tx.find<OutboxItem>(C.outbox, { status: "SENT" })) if (s.ms() - Date.parse(o.sentAt ?? o.createdAt) > 30 * 86_400_000) s.tx.delete(C.outbox, o.notificationId);
  }

  get(s: Scope, id: string) { return s.tx.get<OutboxItem>(C.outbox, id); }
}
