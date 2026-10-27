import { Controller, Get, Post } from "@nestjs/common";
import { DomainError } from "@livecoco/domain";
import { is } from "@livecoco/contracts";
import { C, Idempotent, Shape, created, raw, type Ctx } from "../route-kit.ts";

/** Release D: partners, inspections, logistics quotes, FPO aggregation, settlements and media upload intents. */
@Controller("v1")
export class FulfilmentController {
  @Get("partner/inspections")
  getPartnerInspections(@C() { p, user }: Ctx) {
    return ({ items: [...p.fx.inspections.values()].filter((i) => p.orgs.get(i.partnerId)?.members.some((m) => m.userId === user.userId)) });
  }

  @Get("partner/transport-jobs")
  getPartnerTransportJobs(@C() { p, user }: Ctx) {
    return ({ items: [...p.fx.transportRequests.values()].filter((r) => r.partnerId && p.orgs.get(r.partnerId)?.members.some((m) => m.userId === user.userId)) });
  }

  @Get("me/partners")
  getMePartners(@C() { p, user }: Ctx) {
    return ({ items: [...p.fx.partners.values()].filter((x) => p.orgs.get(x.organizationId)?.members.some((m) => m.userId === user.userId)) });
  }

  @Post("partners")
  @Shape({ organizationId: is.string, serviceMarketIds: is.stringArray })
  @Idempotent()
  postPartners(@C() { p, user, body }: Ctx) {
    return created(p.fx.applyPartner(user, body.organizationId, body.serviceMarketIds));
  }

  @Get("partners")
  getPartners(@C() { p, query }: Ctx) {
    return ({ items: p.fx.listPartners(query.get("kind") ?? undefined, query.get("marketId") ?? undefined) });
  }

  @Get("partners/:id/sla")
  getPartnersSla(@C() { p, user, params }: Ctx) {
    const id = params.id as string;
    if (!p.orgs.get(id)?.members.some((m) => m.userId === user.userId) && !user.capabilities.includes("ops.verification")) throw new DomainError("NOT_FOUND", 404, "Not found", "error.not_found");
    return p.fx.partnerSla(id);
  }

  @Post("ops/partners/:id/decision")
  @Shape({ decision: is.oneOf("APPROVED", "REJECTED", "SUSPENDED"), reason: is.string })
  postOpsPartnersDecision(@C() { p, user, session, params, body }: Ctx) {
    return p.fx.decidePartner(user, session, params.id as string, body.decision, body.reason);
  }

  @Get("deals/:id/inspections")
  getDealsInspections(@C() { p, user, params }: Ctx) {
    return (p.dealParty(user, params.id as string), { items: [...p.fx.inspections.values()].filter((i) => i.dealId === params.id) });
  }

  @Post("deals/:id/inspections")
  @Shape({ partnerId: is.string, scheduledAt: is.iso, location: is.string })
  @Idempotent()
  postDealsInspections(@C() { p, user, params, body }: Ctx) {
    return created(p.fx.requestInspection(user, params.id as string, body as never));
  }

  @Post("inspections/:id/accept")
  @Idempotent()
  postInspectionsAccept(@C() { p, user, params }: Ctx) {
    return p.fx.acceptInspection(user, params.id as string);
  }

  @Post("inspections/:id/result")
  @Shape({ outcome: is.string, measurements: is.object, note: is.string })
  @Idempotent()
  postInspectionsResult(@C() { p, user, params, body }: Ctx) {
    return p.fx.submitInspectionResult(user, params.id as string, body as never);
  }

  @Post("inspections/:id/decision")
  @Shape({ accept: is.bool })
  @Idempotent()
  postInspectionsDecision(@C() { p, user, params, body }: Ctx) {
    return p.fx.decideInspection(user, params.id as string, body.accept);
  }

  @Post("deals/:id/transport-requests")
  @Shape({ destinationMarketId: is.string, weightKg: (v) => typeof v === "number" && v > 0, windowFrom: is.iso, windowTo: is.iso })
  @Idempotent()
  postDealsTransportRequests(@C() { p, user, params, body }: Ctx) {
    return created(p.fx.requestTransport(user, params.id as string, body as never));
  }

  @Get("partner/transport-requests")
  getPartnerTransportRequests(@C() { p, user }: Ctx) {
    return ({ items: p.fx.openTransportRequests(user) });
  }

  @Get("transport-requests/:id")
  getTransportRequestsById(@C() { p, user, params }: Ctx) {
    return p.fx.getTransport(user, params.id as string);
  }

  @Post("transport-requests/:id/quotes")
  @Shape({ pricePaise: is.int, vehicleType: is.string, etaFrom: is.iso, etaTo: is.iso, validUntil: is.iso })
  @Idempotent()
  postTransportRequestsQuotes(@C() { p, user, params, body }: Ctx) {
    return created(p.fx.submitTransportQuote(user, params.id as string, body as never));
  }

  @Get("transport-requests/:id/quotes")
  getTransportRequestsQuotes(@C() { p, user, params }: Ctx) {
    return ({ items: p.fx.listTransportQuotes(user, params.id as string) });
  }

  @Post("transport-quotes/:id/book")
  @Shape({ vehicle: is.object })
  @Idempotent()
  postTransportQuotesBook(@C() { p, user, params, body }: Ctx) {
    return p.fx.bookTransport(user, params.id as string, body.vehicle);
  }

  @Post("transport-requests/:id/status")
  @Shape({ status: is.oneOf("PICKED_UP", "IN_TRANSIT", "DELIVERED") })
  @Idempotent()
  postTransportRequestsStatus(@C() { p, user, params, body }: Ctx) {
    return p.fx.updateTransport(user, params.id as string, body.status, body.note ?? "");
  }

  @Get("organizations/:id/member-lots")
  getOrganizationsMemberLots(@C() { p, user, params }: Ctx) {
    if (!p.orgs.get(params.id as string)?.members.some((m) => m.userId === user.userId)) throw new DomainError("NOT_FOUND", 404, "Not found", "error.not_found");
    return { items: [...p.fx.memberLots.values()].filter((m) => m.organizationId === params.id) };
  }

  @Post("organizations/:id/member-lots")
  @Shape({ memberName: is.string, productId: is.string, gradeGroup: is.string, unit: is.string, quantity: is.string, originMarketId: is.string })
  @Idempotent()
  postOrganizationsMemberLots(@C() { p, user, params, body }: Ctx) {
    return created(p.fx.addMemberLot(user, params.id as string, body as never));
  }

  @Post("member-lots/:id/review")
  @Shape({ approve: is.bool })
  postMemberLotsReview(@C() { p, user, params, body }: Ctx) {
    return p.fx.reviewMemberLot(user, params.id as string, body.approve);
  }

  @Post("organizations/:id/aggregates")
  @Shape({ memberLotIds: is.stringArray, availableFrom: is.iso, availableTo: is.iso, expiresAt: is.iso, fulfilment: is.object, priceExpectation: is.object })
  @Idempotent()
  postOrganizationsAggregates(@C() { p, user, params, body }: Ctx) {
    return created(p.fx.buildAggregate(user, params.id as string, body as never));
  }

  @Post("deals/:id/settlement")
  @Idempotent()
  postDealsSettlement(@C() { p, user, params, body }: Ctx) {
    return created(p.fx.draftSettlement(user, params.id as string, body.deductions ?? []));
  }

  @Get("settlements/:id")
  getSettlementsById(@C() { p, user, params }: Ctx) {
    const s = p.fx.settlements.get(params.id as string);
    if (!s || !p.orgs.get(s.organizationId)?.members.some((m) => m.userId === user.userId)) throw new DomainError("NOT_FOUND", 404, "Not found", "error.not_found");
    return s;
  }

  @Post("settlements/:id/approve")
  @Idempotent()
  postSettlementsApprove(@C() { p, user, params }: Ctx) {
    return p.fx.approveSettlement(user, params.id as string);
  }

  @Get("settlements/:id/export")
  getSettlementsExport(@C() { p, user, params }: Ctx) {
    return raw(200, p.fx.exportSettlementCsv(user, params.id as string), "text/csv; charset=utf-8");
  }

  @Post("uploads/intents")
  @Shape({ purpose: is.oneOf("LOT_PHOTO", "DEAL_EVIDENCE", "VERIFICATION_DOCUMENT"), contentType: is.string, sizeBytes: is.int })
  @Idempotent()
  postUploadsIntents(@C() { p, user, body }: Ctx) {
    return created(p.fx.createUploadIntent(user, body as never));
  }
}
