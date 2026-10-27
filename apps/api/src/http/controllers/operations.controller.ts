import { Controller, Get, Post } from "@nestjs/common";
import { DomainError } from "@livecoco/domain";
import { is } from "@livecoco/contracts";
import { C, Shape, type Ctx } from "../route-kit.ts";

/** Operator console: review queues, source health, audit, claims, listings and disputes (capability + step-up enforced in the platform). */
@Controller("v1")
export class OperationsController {
  @Get("ops/queues")
  getOpsQueues(@C() { p, user, session, query }: Ctx) {
    return ({ items: p.listQueue(user, session, (query.get("queue") ?? undefined) as never) });
  }

  @Get("ops/source-health")
  getOpsSourceHealth(@C() { p, user, session }: Ctx) {
    return ({ items: p.listSourceHealth(user, session) });
  }

  @Get("ops/audit")
  getOpsAudit(@C() { p, user, session }: Ctx) {
    return ({ items: p.readAudit(user, session) });
  }

  @Post("ops/observations/:id/review")
  @Shape({ decision: is.oneOf("APPROVE", "REJECT"), reason: is.string })
  postOpsObservationsReview(@C() { p, user, session, params, body }: Ctx) {
    return p.reviewObservation(user, session, params.id as string, body.decision, body.reason);
  }

  @Post("ops/mapping/:id/resolve")
  @Shape({ mapping: is.object, reason: is.string })
  postOpsMappingResolve(@C() { p, user, session, params, body }: Ctx) {
    return p.resolveMapping(user, session, params.id as string, body.mapping, body.reason);
  }

  @Post("ops/prices/refresh")
  postOpsPricesRefresh(@C() { p, user, session }: Ctx) {
    return (p.require(user, session, "ops.price_review"), { changed: p.refreshAggregates() });
  }

  @Post("ops/claims/:id/decision")
  @Shape({ decision: is.string, reasonCode: is.string })
  postOpsClaimsDecision(@C() { p, user, session, params, body }: Ctx) {
    return p.decideClaim(user, session, params.id as string, body.decision, body.reasonCode, body.expiresAt);
  }

  @Post("ops/listings/:id/review")
  @Shape({ decision: is.oneOf("APPROVE", "SUSPEND", "RETURN"), reason: is.string })
  postOpsListingsReview(@C() { p, user, session, params, body }: Ctx) {
    return p.reviewListing(user, session, params.id as string, body.decision, body.reason);
  }

  @Post("ops/listings/:id/photo-exception")
  @Shape({ reason: is.string })
  postOpsListingsPhotoException(@C() { p, user, session, params, body }: Ctx) {
    return p.grantPhotoException(user, session, params.id as string, body.reason);
  }

  @Get("ops/requirements/:id/matches")
  getOpsRequirementsMatches(@C() { p, user, session, params }: Ctx) {
    return ({ items: p.operatorMatches(user, session, params.id as string) });
  }

  @Get("ops/disputes/:id")
  getOpsDisputesById(@C() { p, user, session, params }: Ctx) {
    return (p.require(user, session, "ops.disputes"), p.disputes.get(params.id as string) ?? (() => { throw new DomainError("NOT_FOUND", 404, "Not found", "error.not_found"); })());
  }

  @Post("ops/disputes/:id/resolve")
  @Shape({ outcome: is.string, reason: is.string })
  postOpsDisputesResolve(@C() { p, user, session, params, body }: Ctx) {
    return p.resolveDispute(user, session, params.id as string, body.outcome, body.reason);
  }

  @Post("ops/users/:id/suspend")
  @Shape({ reason: is.string })
  postOpsUsersSuspend(@C() { p, user, session, params, body }: Ctx) {
    return (p.suspendUser(user, session, params.id as string, body.reason), { ok: true });
  }
}
