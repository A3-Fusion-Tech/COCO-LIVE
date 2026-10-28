import { uid } from "./ids.ts";
import { C, L } from "./collections.ts";
import type { Scope } from "./scope.ts";
import type { Capability } from "../modules/identity/identity.types.ts";

export interface AuditEntry { seq: number; at: string; actorId: string; action: string; subject: string; reason: string | undefined; correlationId: string; meta: Record<string, unknown> }

export type QueueName = "PRICE_REVIEW" | "MAPPING" | "VERIFICATION" | "LISTING_REVIEW" | "DISPUTE" | "RISK";
export interface QueueItem { queueItemId: string; queue: QueueName; subject: string; summary: string; reasons: string[]; priority: number; createdAt: string; requiredCapability: Capability; status: "OPEN" | "DONE" }

/** Append-only audit trail; every entry carries the request's correlation id. */
export class AuditLog {
  record(s: Scope, actorId: string, action: string, subject: string, reason?: string, meta: Record<string, unknown> = {}) {
    s.tx.append(L.audit, { at: s.iso(), actorId, action, subject, reason, correlationId: s.cid, meta });
  }
  all(s: Scope) { return s.tx.findLog<AuditEntry>(L.audit); }
}

/** Operator work queues (price review, mapping, verification, listings, disputes, risk). */
export class WorkQueue {
  enqueue(s: Scope, i: Omit<QueueItem, "queueItemId" | "createdAt" | "status">) {
    const id = uid("q");
    s.tx.put(C.queue, id, { ...i, queueItemId: id, createdAt: s.iso(), status: "OPEN" } satisfies QueueItem);
    return id;
  }
  get(s: Scope, id: string) { return s.tx.get<QueueItem>(C.queue, id); }
  /** Marks every open item about `subject` as done. */
  async close(s: Scope, subject: string) {
    for (const q of await s.tx.find<QueueItem>(C.queue, { subject, status: "OPEN" })) s.tx.put(C.queue, q.queueItemId, { ...q, status: "DONE" });
  }
  open(s: Scope) { return s.tx.find<QueueItem>(C.queue, { status: "OPEN" }); }
}
