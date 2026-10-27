import { Controller, Get, Inject, Post } from "@nestjs/common";
import { is } from "@livecoco/contracts";
import { C, Public, Shape, created, items, ok, type Ctx } from "../../http/route-kit.ts";
import { IdentityService } from "../identity/identity.service.ts";
import { DealsService } from "../deals/deals.service.ts";
import { LotsService } from "../marketplace/lots.service.ts";
import { Reputation } from "../marketplace/participants.ts";
import { RequirementsService } from "../marketplace/requirements.service.ts";
import { PricesService } from "../prices/prices.service.ts";
import { OperationsService } from "./operations.service.ts";

/** Trust & safety for participants, and the operator console (capability + step-up enforced in the services). */
@Controller("v1")
export class OperationsController {
  private readonly ops: OperationsService;
  private readonly identity: IdentityService;
  private readonly prices: PricesService;
  private readonly lots: LotsService;
  private readonly requirements: RequirementsService;
  private readonly deals: DealsService;
  private readonly reputation: Reputation;
  constructor(
    @Inject(OperationsService) ops: OperationsService, @Inject(IdentityService) identity: IdentityService, @Inject(PricesService) prices: PricesService, @Inject(LotsService) lots: LotsService,
    @Inject(RequirementsService) requirements: RequirementsService, @Inject(DealsService) deals: DealsService, @Inject(Reputation) reputation: Reputation,
  ) {
    this.ops = ops;
    this.identity = identity;
    this.prices = prices;
    this.lots = lots;
    this.requirements = requirements;
    this.deals = deals;
    this.reputation = reputation;
  }

  // ---- participants --------------------------------------------------------------------------
  @Post("users/:id/block")
  block(@C() { s, params }: Ctx) {
    return ok(this.ops.block(s, params.id as string));
  }

  @Post("users/:id/report")
  @Shape({ reason: is.string })
  async report(@C() { s, params, body }: Ctx) {
    return created(await this.ops.report(s, params.id as string, body.reason));
  }

  @Get("users/:id/reputation")
  @Public()
  reputationOf(@C() { s, params }: Ctx) {
    return this.reputation.publicSummary(s, params.id as string);
  }

  // ---- operator console ----------------------------------------------------------------------
  @Get("ops/queues")
  queues(@C() { s, query }: Ctx) {
    return items(this.ops.listQueue(s, (query.get("queue") ?? undefined) as never));
  }

  @Get("ops/source-health")
  sourceHealth(@C() { s }: Ctx) {
    return items(this.prices.listSourceHealth(s));
  }

  @Get("ops/audit")
  audit(@C() { s }: Ctx) {
    return items(this.ops.readAudit(s));
  }

  @Post("ops/observations/:id/review")
  @Shape({ decision: is.oneOf("APPROVE", "REJECT"), reason: is.string })
  reviewObservation(@C() { s, params, body }: Ctx) {
    return this.prices.reviewObservation(s, params.id as string, body.decision, body.reason);
  }

  @Post("ops/mapping/:id/resolve")
  @Shape({ mapping: is.object, reason: is.string })
  resolveMapping(@C() { s, params, body }: Ctx) {
    return this.prices.resolveMapping(s, params.id as string, body.mapping, body.reason);
  }

  @Post("ops/prices/refresh")
  async refreshPrices(@C() { s }: Ctx) {
    this.identity.require(s, "ops.price_review");
    return { changed: await this.prices.refreshAggregates(s) };
  }

  @Post("ops/claims/:id/decision")
  @Shape({ decision: is.string, reasonCode: is.string })
  decideClaim(@C() { s, params, body }: Ctx) {
    return this.identity.decideClaim(s, params.id as string, body.decision, body.reasonCode, body.expiresAt);
  }

  @Post("ops/listings/:id/review")
  @Shape({ decision: is.oneOf("APPROVE", "SUSPEND", "RETURN"), reason: is.string })
  reviewListing(@C() { s, params, body }: Ctx) {
    return this.lots.review(s, params.id as string, body.decision, body.reason);
  }

  @Post("ops/listings/:id/photo-exception")
  @Shape({ reason: is.string })
  photoException(@C() { s, params, body }: Ctx) {
    return this.lots.grantPhotoException(s, params.id as string, body.reason);
  }

  @Get("ops/requirements/:id/matches")
  operatorMatches(@C() { s, params }: Ctx) {
    return items(this.requirements.operatorMatches(s, params.id as string));
  }

  @Get("ops/disputes/:id")
  dispute(@C() { s, params }: Ctx) {
    return this.deals.disputeForOperator(s, params.id as string);
  }

  @Post("ops/disputes/:id/resolve")
  @Shape({ outcome: is.string, reason: is.string })
  resolveDispute(@C() { s, params, body }: Ctx) {
    return this.deals.resolveDispute(s, params.id as string, body.outcome, body.reason);
  }

  @Post("ops/users/:id/suspend")
  @Shape({ reason: is.string })
  suspend(@C() { s, params, body }: Ctx) {
    return ok(this.ops.suspend(s, params.id as string, body.reason));
  }
}
