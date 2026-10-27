import { Controller, Get, Post } from "@nestjs/common";
import { is } from "@livecoco/contracts";
import { C, Idempotent, Public, Shape, created, termsShape, type Ctx } from "../route-kit.ts";

/** Offers, counter-offers and negotiation threads, including contact reveal, block and report. */
@Controller("v1")
export class OffersController {
  @Post("offers")
  @Shape({ sellLotId: is.string, ...termsShape })
  @Idempotent()
  postOffers(@C() { p, user, body }: Ctx) {
    return created(p.createOffer(user, body as never));
  }

  @Get("offers")
  getOffers(@C() { p, user }: Ctx) {
    return ({ items: p.listOffers(user) });
  }

  @Post("offers/:id/counter")
  @Shape(termsShape)
  @Idempotent()
  postOffersCounter(@C() { p, user, params, body, ifMatch }: Ctx) {
    return created(p.counterOffer(user, params.id as string, body.terms, body.expiresAt, ifMatch));
  }

  @Post("offers/:id/accept")
  @Idempotent()
  postOffersAccept(@C() { p, user, params, ifMatch }: Ctx) {
    return created(p.acceptOffer(user, params.id as string, ifMatch));
  }

  @Post("offers/:id/reject")
  postOffersReject(@C() { p, user, params }: Ctx) {
    return p.rejectOffer(user, params.id as string);
  }

  @Post("offers/:id/withdraw")
  postOffersWithdraw(@C() { p, user, params }: Ctx) {
    return p.withdrawOffer(user, params.id as string);
  }

  @Post("threads/:id/contact-reveal")
  @Idempotent()
  postThreadsContactReveal(@C() { p, user, params }: Ctx) {
    return p.revealContact(user, params.id as string);
  }

  @Post("users/:id/block")
  postUsersBlock(@C() { p, user, params }: Ctx) {
    return (p.blockUser(user, params.id as string), { ok: true });
  }

  @Post("users/:id/report")
  @Shape({ reason: is.string })
  postUsersReport(@C() { p, user, params, body }: Ctx) {
    return created(p.reportUser(user, params.id as string, body.reason));
  }

  @Get("users/:id/reputation")
  @Public()
  getUsersReputation(@C() { p, params }: Ctx) {
    return p.publicReputation(params.id as string);
  }
}
