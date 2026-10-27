import { Controller, Get, Inject, Post } from "@nestjs/common";
import { is } from "@livecoco/contracts";
import { C, Idempotent, Shape, created, items, raw, type Ctx } from "../../http/route-kit.ts";
import { FpoService } from "./fpo.service.ts";
import { PartnersService } from "./partners.service.ts";

/** Inspection and logistics partners, FPO aggregation and member settlements. */
@Controller("v1")
export class FulfilmentController {
  private readonly partners: PartnersService;
  private readonly fpo: FpoService;
  constructor(@Inject(PartnersService) partners: PartnersService, @Inject(FpoService) fpo: FpoService) {
    this.partners = partners;
    this.fpo = fpo;
  }

  // ---- partners ------------------------------------------------------------------------------
  @Post("partners")
  @Shape({ organizationId: is.string, serviceMarketIds: is.stringArray })
  @Idempotent()
  async apply(@C() { s, body }: Ctx) {
    return created(await this.partners.apply(s, body.organizationId, body.serviceMarketIds));
  }

  @Get("partners")
  list(@C() { s, query }: Ctx) {
    return items(this.partners.list(s, query.get("kind") ?? undefined, query.get("marketId") ?? undefined));
  }

  @Get("me/partners")
  mine(@C() { s }: Ctx) {
    return items(this.partners.mine(s));
  }

  @Get("partners/:id/sla")
  sla(@C() { s, params }: Ctx) {
    return this.partners.sla(s, params.id as string);
  }

  @Post("ops/partners/:id/decision")
  @Shape({ decision: is.oneOf("APPROVED", "REJECTED", "SUSPENDED"), reason: is.string })
  decide(@C() { s, params, body }: Ctx) {
    return this.partners.decide(s, params.id as string, body.decision, body.reason);
  }

  // ---- inspections ---------------------------------------------------------------------------
  @Get("partner/inspections")
  myInspections(@C() { s }: Ctx) {
    return items(this.partners.myInspections(s));
  }

  @Get("deals/:id/inspections")
  dealInspections(@C() { s, params }: Ctx) {
    return items(this.partners.dealInspections(s, params.id as string));
  }

  @Post("deals/:id/inspections")
  @Shape({ partnerId: is.string, scheduledAt: is.iso, location: is.string })
  @Idempotent()
  async requestInspection(@C() { s, params, body }: Ctx) {
    return created(await this.partners.requestInspection(s, params.id as string, body as never));
  }

  @Post("inspections/:id/accept")
  @Idempotent()
  acceptInspection(@C() { s, params }: Ctx) {
    return this.partners.acceptInspection(s, params.id as string);
  }

  @Post("inspections/:id/result")
  @Shape({ outcome: is.string, measurements: is.object, note: is.string })
  @Idempotent()
  inspectionResult(@C() { s, params, body }: Ctx) {
    return this.partners.submitResult(s, params.id as string, body as never);
  }

  @Post("inspections/:id/decision")
  @Shape({ accept: is.bool })
  @Idempotent()
  inspectionDecision(@C() { s, params, body }: Ctx) {
    return this.partners.decideInspection(s, params.id as string, body.accept);
  }

  // ---- logistics -----------------------------------------------------------------------------
  @Post("deals/:id/transport-requests")
  @Shape({ destinationMarketId: is.string, weightKg: (v) => typeof v === "number" && v > 0, windowFrom: is.iso, windowTo: is.iso })
  @Idempotent()
  async requestTransport(@C() { s, params, body }: Ctx) {
    return created(await this.partners.requestTransport(s, params.id as string, body as never));
  }

  @Get("partner/transport-requests")
  openRequests(@C() { s }: Ctx) {
    return items(this.partners.openRequests(s));
  }

  @Get("partner/transport-jobs")
  myJobs(@C() { s }: Ctx) {
    return items(this.partners.myJobs(s));
  }

  @Get("transport-requests/:id")
  getTransport(@C() { s, params }: Ctx) {
    return this.partners.getTransport(s, params.id as string);
  }

  @Post("transport-requests/:id/quotes")
  @Shape({ pricePaise: is.int, vehicleType: is.string, etaFrom: is.iso, etaTo: is.iso, validUntil: is.iso })
  @Idempotent()
  async submitQuote(@C() { s, params, body }: Ctx) {
    return created(await this.partners.submitQuote(s, params.id as string, body as never));
  }

  @Get("transport-requests/:id/quotes")
  quotes(@C() { s, params }: Ctx) {
    return items(this.partners.listQuotes(s, params.id as string));
  }

  @Post("transport-quotes/:id/book")
  @Shape({ vehicle: is.object })
  @Idempotent()
  book(@C() { s, params, body }: Ctx) {
    return this.partners.book(s, params.id as string, body.vehicle);
  }

  @Post("transport-requests/:id/status")
  @Shape({ status: is.oneOf("PICKED_UP", "IN_TRANSIT", "DELIVERED") })
  @Idempotent()
  transportStatus(@C() { s, params, body }: Ctx) {
    return this.partners.updateTransport(s, params.id as string, body.status, body.note ?? "");
  }

  // ---- FPO aggregation and settlement --------------------------------------------------------
  @Get("organizations/:id/member-lots")
  memberLots(@C() { s, params }: Ctx) {
    return items(this.fpo.memberLots(s, params.id as string));
  }

  @Post("organizations/:id/member-lots")
  @Shape({ memberName: is.string, productId: is.string, gradeGroup: is.string, unit: is.string, quantity: is.string, originMarketId: is.string })
  @Idempotent()
  async addMemberLot(@C() { s, params, body }: Ctx) {
    return created(await this.fpo.addMemberLot(s, params.id as string, body as never));
  }

  @Post("member-lots/:id/review")
  @Shape({ approve: is.bool })
  reviewMemberLot(@C() { s, params, body }: Ctx) {
    return this.fpo.reviewMemberLot(s, params.id as string, body.approve);
  }

  @Post("organizations/:id/aggregates")
  @Shape({ memberLotIds: is.stringArray, availableFrom: is.iso, availableTo: is.iso, expiresAt: is.iso, fulfilment: is.object, priceExpectation: is.object })
  @Idempotent()
  async buildAggregate(@C() { s, params, body }: Ctx) {
    return created(await this.fpo.buildAggregate(s, params.id as string, body as never));
  }

  @Post("deals/:id/settlement")
  @Idempotent()
  async draftSettlement(@C() { s, params, body }: Ctx) {
    return created(await this.fpo.draftSettlement(s, params.id as string, body.deductions ?? []));
  }

  @Get("settlements/:id")
  settlement(@C() { s, params }: Ctx) {
    return this.fpo.settlement(s, params.id as string);
  }

  @Post("settlements/:id/approve")
  @Idempotent()
  approveSettlement(@C() { s, params }: Ctx) {
    return this.fpo.approveSettlement(s, params.id as string);
  }

  @Get("settlements/:id/export")
  async exportSettlement(@C() { s, params }: Ctx) {
    return raw(200, await this.fpo.exportSettlementCsv(s, params.id as string), "text/csv; charset=utf-8");
  }
}
