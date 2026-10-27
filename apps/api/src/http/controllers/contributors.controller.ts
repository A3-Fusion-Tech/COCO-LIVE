import { Controller, Post } from "@nestjs/common";
import { is } from "@livecoco/contracts";
import { C, Idempotent, Shape, created, money, type Ctx } from "../route-kit.ts";

/** Approved price contributors: executable quotes and corrections. */
@Controller("v1")
export class ContributorsController {
  @Post("contributor/quotes")
  @Shape({ productId: is.string, marketId: is.string, gradeGroup: is.string, unit: is.string, stage: is.string, tradeTerm: is.string, lowPaise: money, highPaise: money, observedAt: is.iso, organizationId: is.string })
  @Idempotent()
  postContributorQuotes(@C() { p, user, body }: Ctx) {
    return created(p.submitQuote(user, body as never));
  }

  @Post("contributor/observations/:id/correction")
  @Shape({ lowPaise: money, highPaise: money, reason: is.string })
  @Idempotent()
  postContributorObservationsCorrection(@C() { p, user, session, params, body }: Ctx) {
    return p.correctObservation(user, session, params.id as string, { lowPaise: body.lowPaise, highPaise: body.highPaise, ...(body.referencePaise !== undefined ? { referencePaise: body.referencePaise } : {}) }, body.reason);
  }
}
