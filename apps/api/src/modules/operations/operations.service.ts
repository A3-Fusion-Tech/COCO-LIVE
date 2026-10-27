import { DomainError, forbidden, invalid, notFound } from "@livecoco/domain";
import { L } from "../../core/collections.ts";
import { uid } from "../../core/ids.ts";
import type { Scope } from "../../core/scope.ts";
import type { AuditLog, QueueName, WorkQueue } from "../../core/audit.ts";
import type { IdentityService } from "../identity/identity.service.ts";
import type { LotsService } from "../marketplace/lots.service.ts";

export interface Report { reportId: string; reporterId: string; subjectUserId: string; reason: string; at: string }

/** Trust & safety (block, report, suspend) and the operator console's queues and audit trail. */
export class OperationsService {
  private readonly identity: IdentityService;
  private readonly lots: LotsService;
  private readonly audit: AuditLog;
  private readonly queue: WorkQueue;

  constructor(identity: IdentityService, lots: LotsService, audit: AuditLog, queue: WorkQueue) {
    this.identity = identity;
    this.lots = lots;
    this.audit = audit;
    this.queue = queue;
  }

  async block(s: Scope, targetId: string) {
    if (!(await this.identity.user(s, targetId))) throw notFound("User");
    const me = s.user;
    if (!me.blocked.includes(targetId)) { me.blocked.push(targetId); this.identity.saveUser(s, me); }
  }

  async report(s: Scope, subjectUserId: string, reason: string): Promise<Report> {
    if (!(await this.identity.user(s, subjectUserId))) throw notFound("User");
    const r: Report = { reportId: uid("rep"), reporterId: s.user.userId, subjectUserId, reason, at: s.iso() };
    s.tx.append(L.reports, { ...r });
    this.queue.enqueue(s, { queue: "RISK", subject: subjectUserId, summary: "User reported", reasons: [reason], priority: 2, requiredCapability: "ops.listings" });
    return r;
  }

  /** Suspension revokes every session and hides the user's unreserved lots. */
  async suspend(s: Scope, userId: string, reason: string) {
    this.identity.require(s, "ops.listings");
    if (!reason) throw invalid("REASON_REQUIRED", "A reason is required");
    const u = await this.identity.requireUser(s, userId);
    u.suspended = true;
    this.identity.saveUser(s, u);
    await this.identity.revokeAllSessions(s, userId);
    await this.lots.suspendSellerLots(s, userId);
    this.audit.record(s, s.user.userId, "USER_SUSPENDED", userId, reason);
  }

  /** Open items the operator has the capability for, most urgent first. */
  async listQueue(s: Scope, queue?: QueueName) {
    const op = s.user;
    if (!op.capabilities.some((c) => c.startsWith("ops."))) throw forbidden();
    if (!this.identity.hasStepUp(s)) throw new DomainError("STEP_UP_REQUIRED", 403, "Step-up authentication required");
    return (await this.queue.open(s))
      .filter((q) => (!queue || q.queue === queue) && op.capabilities.includes(q.requiredCapability))
      .sort((a, b) => a.priority - b.priority || a.createdAt.localeCompare(b.createdAt) || a.queueItemId.localeCompare(b.queueItemId))
      .map((q) => ({ ...q, ageMinutes: Math.floor((s.ms() - Date.parse(q.createdAt)) / 60_000) }));
  }

  async readAudit(s: Scope) {
    this.identity.require(s, "ops.audit");
    return this.audit.all(s);
  }
}
