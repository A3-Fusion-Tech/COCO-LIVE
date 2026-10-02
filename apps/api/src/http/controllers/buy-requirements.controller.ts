import { Controller, Get, Post } from "@nestjs/common";
import { is } from "../../../../../packages/contracts/src/index.ts";
import { C, Idempotent, Shape, created, reqShape, type Ctx } from "../route-kit.ts";

/** Buyer requirements, recurring requirements and seller matches. */
@Controller("v1")
export class BuyRequirementsController {
  @Post("buy-requirements")
  @Shape(reqShape)
  @Idempotent()
  postBuyRequirements(@C() { p, user, body }: Ctx) {
    return created(p.createRequirement(user, body as never));
  }

  @Post("buy-requirements/recurring")
  @Shape({ ...reqShape, cadence: is.oneOf("WEEKLY", "FORTNIGHTLY", "MONTHLY"), occurrences: is.int })
  @Idempotent()
  postBuyRequirementsRecurring(@C() { p, user, body }: Ctx) {
    return created(p.createRecurringRequirement(user, body as never, body.cadence, body.occurrences));
  }

  @Get("me/buy-requirements")
  getMeBuyRequirements(@C() { p, user }: Ctx) {
    return ({ items: [...p.requirements.values()].filter((r) => r.buyerId === user.userId) });
  }

  @Get("buy-requirements/:id/matches")
  getBuyRequirementsMatches(@C() { p, user, params }: Ctx) {
    return ({ items: p.matchesForRequirement(user, params.id as string) });
  }

  @Post("buy-requirements/:id/close")
  postBuyRequirementsClose(@C() { p, user, params }: Ctx) {
    return p.closeRequirement(user, params.id as string);
  }
}
