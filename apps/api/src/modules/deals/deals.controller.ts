import { Controller, Get, Inject, Post } from "@nestjs/common";
import { is } from "@livecoco/contracts";
import { C, Idempotent, Shape, created, items, type Ctx } from "../../http/route-kit.ts";
import { DealsService } from "./deals.service.ts";

/** Deal cards, amendments, fulfilment milestones, cancellation, evidence and disputes. */
@Controller("v1")
export class DealsController {
  private readonly deals: DealsService;
  constructor(@Inject(DealsService) deals: DealsService) { this.deals = deals; }

  @Get("deals")
  myDeals(@C() { s }: Ctx) {
    return items(this.deals.mine(s));
  }

  @Get("deals/:id")
  getDeal(@C() { s, params }: Ctx) {
    return this.deals.view(s, params.id as string);
  }

  @Post("deals/:id/amendments")
  @Shape({ terms: is.object })
  @Idempotent()
  proposeAmendment(@C() { s, params, body }: Ctx) {
    return this.deals.proposeAmendment(s, params.id as string, body.terms);
  }

  @Post("deals/:id/amendments/respond")
  @Shape({ accept: is.bool })
  respondAmendment(@C() { s, params, body }: Ctx) {
    return this.deals.respondAmendment(s, params.id as string, body.accept);
  }

  @Post("deals/:id/pickup")
  @Idempotent()
  pickup(@C() { s, params }: Ctx) {
    return this.deals.confirmPickup(s, params.id as string);
  }

  @Post("deals/:id/delivery")
  @Idempotent()
  delivery(@C() { s, params, body }: Ctx) {
    return this.deals.confirmDelivery(s, params.id as string, body.actualQuantity);
  }

  @Post("deals/:id/accept")
  @Idempotent()
  acceptDelivery(@C() { s, params }: Ctx) {
    return this.deals.acceptDelivery(s, params.id as string);
  }

  @Post("deals/:id/payment")
  @Shape({ method: is.string })
  @Idempotent()
  payment(@C() { s, params, body }: Ctx) {
    return this.deals.confirmPayment(s, params.id as string, body.method);
  }

  @Post("deals/:id/complete")
  @Idempotent()
  complete(@C() { s, params }: Ctx) {
    return this.deals.complete(s, params.id as string);
  }

  @Post("deals/:id/cancel")
  @Shape({ reason: is.string })
  @Idempotent()
  cancel(@C() { s, params, body }: Ctx) {
    return this.deals.cancel(s, params.id as string, body.reason);
  }

  @Post("deals/:id/evidence")
  @Shape({ kind: is.string, note: is.string })
  async addEvidence(@C() { s, params, body }: Ctx) {
    return created(await this.deals.addEvidence(s, params.id as string, body.kind, body.note));
  }

  @Get("deals/:id/evidence")
  evidence(@C() { s, params }: Ctx) {
    return items(this.deals.evidence(s, params.id as string));
  }

  @Post("deals/:id/disputes")
  @Shape({ reason: is.string })
  @Idempotent()
  async openDispute(@C() { s, params, body }: Ctx) {
    return created(await this.deals.openDispute(s, params.id as string, body as never));
  }

  @Get("disputes/:id")
  getDispute(@C() { s, params }: Ctx) {
    return this.deals.disputeForParty(s, params.id as string);
  }

  @Post("disputes/:id/response")
  @Shape({ text: is.string })
  respondDispute(@C() { s, params, body }: Ctx) {
    return this.deals.respondDispute(s, params.id as string, body.text, body.evidenceIds ?? []);
  }
}
