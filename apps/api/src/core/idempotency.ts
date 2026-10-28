import { createHash } from "node:crypto";
import { DomainError, conflict } from "@livecoco/domain";
import { C } from "./collections.ts";
import type { Scope } from "./scope.ts";

interface Stored { key?: string; hash: string; at?: number; result: unknown }

/**
 * Idempotency-Key handling. The key row is read (and locked) in the same unit of work as the operation, so a
 * retry returns the stored outcome; two simultaneous first attempts race on the primary key and the loser's
 * unit of work is retried, after which it finds the winner's result.
 */
export class Idempotency {
  async run<T>(s: Scope, actorId: string, endpoint: string, key: string | undefined, payload: unknown, fn: () => Promise<T>): Promise<T> {
    if (!key) throw new DomainError("IDEMPOTENCY_KEY_REQUIRED", 400, "Idempotency-Key header required");
    const k = `${actorId}|${endpoint}|${key}`;
    const hash = createHash("sha256").update(JSON.stringify(payload ?? null)).digest("hex");
    const prev = await s.tx.get<Stored>(C.idempotency, k);
    if (prev) {
      if (prev.hash !== hash) throw conflict("IDEMPOTENCY_KEY_REUSED", "Idempotency key reused with a different payload");
      return prev.result as T;
    }
    const result = await fn();
    // A JSON snapshot, so a retry returns the original outcome rather than the entity's later state.
    s.tx.put(C.idempotency, k, { key: k, hash, at: s.ms(), result: JSON.parse(JSON.stringify(result ?? null)) } satisfies Stored);
    return result;
  }

  /** Retention: keys older than 7 days. */
  async purge(s: Scope) {
    let n = 0;
    for (const i of await s.tx.find<Stored>(C.idempotency)) if (i.key && i.at !== undefined && s.ms() - i.at > 7 * 86_400_000) { s.tx.delete(C.idempotency, i.key); n++; }
    return n;
  }
}
