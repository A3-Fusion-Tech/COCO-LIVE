import { Controller, Get, Post } from "@nestjs/common";
import { is } from "../../../../../packages/contracts/src/index.ts";
import { C, Idempotent, Shape, created, type Ctx } from "../route-kit.ts";

/** Deal cards, amendments, fulfilment milestones, cancellation and disputes. */
@Controller("v1")
export class DealsController {
  @Get("deals")
  getDeals(@C() { p, user }: Ctx) {
    return ({ items: p.listDeals(user) });
  }

  @Get("deals/:id")
  getDealsById(@C() { p, user, session, params }: Ctx) {
    return p.getDeal2(user, params.id as string, { session });
  }

  @Post("deals/:id/amendments")
  @Shape({ terms: is.object })
  @Idempotent()
  postDealsAmendments(@C() { p, user, params, body }: Ctx) {
    return p.proposeAmendment(user, params.id as string, body.terms);
  }

  @Post("deals/:id/amendments/respond")
  @Shape({ accept: is.bool })
  postDealsAmendmentsRespond(@C() { p, user, params, body }: Ctx) {
    return p.respondAmendment(user, params.id as string, body.accept);
  }

  @Post("deals/:id/pickup")
  @Idempotent()
  postDealsPickup(@C() { p, user, params }: Ctx) {
    return p.confirmPickup(user, params.id as string);
  }

  @Post("deals/:id/delivery")
  @Idempotent()
  postDealsDelivery(@C() { p, user, params, body }: Ctx) {
    return p.confirmDelivery(user, params.id as string, body.actualQuantity);
  }

  @Post("deals/:id/accept")
  @Idempotent()
  postDealsAccept(@C() { p, user, params }: Ctx) {
    return p.acceptDelivery(user, params.id as string);
  }

  @Post("deals/:id/payment")
  @Shape({ method: is.string })
  @Idempotent()
  postDealsPayment(@C() { p, user, params, body }: Ctx) {
    return p.confirmPayment(user, params.id as string, body.method);
  }

  @Post("deals/:id/complete")
  @Idempotent()
  postDealsComplete(@C() { p, user, params }: Ctx) {
    return p.completeDeal(user, params.id as string);
  }

  @Post("deals/:id/cancel")
  @Shape({ reason: is.string })
  @Idempotent()
  postDealsCancel(@C() { p, user, params, body }: Ctx) {
    return p.cancelDeal(user, params.id as string, body.reason);
  }

  @Post("deals/:id/evidence")
  @Shape({ kind: is.string, note: is.string })
  postDealsEvidence(@C() { p, user, params, body }: Ctx) {
    return created(p.addDealEvidence(user, params.id as string, body.kind, body.note));
  }

  @Get("deals/:id/evidence")
  getDealsEvidence(@C() { p, user, session, params }: Ctx) {
    return ({ items: p.dealEvidence(user, session, params.id as string) });
  }

  @Post("deals/:id/disputes")
  @Shape({ reason: is.string })
  @Idempotent()
  postDealsDisputes(@C() { p, user, params, body }: Ctx) {
    return created(p.openDispute(user, params.id as string, body as never));
  }

  @Get("disputes/:id")
  getDisputesById(@C() { p, user, params }: Ctx) {
    return p.getDispute(user, params.id as string);
  }

  @Post("disputes/:id/response")
  @Shape({ text: is.string })
  postDisputesResponse(@C() { p, user, params, body }: Ctx) {
    return p.respondDispute(user, params.id as string, body.text, body.evidenceIds ?? []);
  }
}
