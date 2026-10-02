import { Controller, Get, Patch, Post } from "@nestjs/common";
import { is } from "../../../../../packages/contracts/src/index.ts";
import { C, Idempotent, Shape, created, type Ctx } from "../route-kit.ts";

/** Seller lots: create, edit, photos, activate, pause and the buyer-facing market. */
@Controller("v1")
export class SellLotsController {
  @Post("sell-lots")
  @Shape({ productId: is.string, gradeAttributes: is.object, gradeGroup: is.string, unit: is.string, quantityTotal: is.string, partialFulfilmentAllowed: is.bool, originMarketId: is.string, availableFrom: is.iso, availableTo: is.iso, expiresAt: is.iso, fulfilment: is.object, priceExpectation: is.object })
  @Idempotent()
  postSellLots(@C() { p, user, body }: Ctx) {
    return created(p.createLot(user, body as never));
  }

  @Get("me/sell-lots")
  getMeSellLots(@C() { p, user }: Ctx) {
    return ({ items: [...p.lots.values()].filter((l) => l.sellerId === user.userId) });
  }

  @Get("sell-lots/:id")
  getSellLotsById(@C() { p, user, params }: Ctx) {
    return p.getLotForOwner(user, params.id as string);
  }

  @Patch("sell-lots/:id")
  patchSellLotsById(@C() { p, user, params, body, ifMatch }: Ctx) {
    return p.updateLot(user, params.id as string, body, ifMatch);
  }

  @Post("sell-lots/:id/photos")
  postSellLotsPhotos(@C() { p, user, params }: Ctx) {
    return p.addLotPhoto(user, params.id as string);
  }

  @Post("sell-lots/:id/activate")
  @Idempotent()
  postSellLotsActivate(@C() { p, user, params }: Ctx) {
    return p.activateLot(user, params.id as string);
  }

  @Post("sell-lots/:id/withdraw")
  @Idempotent()
  postSellLotsWithdraw(@C() { p, user, params }: Ctx) {
    return p.withdrawLot(user, params.id as string);
  }

  @Get("sell-lots/:id/matches")
  getSellLotsMatches(@C() { p, user, params }: Ctx) {
    return ({ items: p.matchesForLot(user, params.id as string) });
  }
}
