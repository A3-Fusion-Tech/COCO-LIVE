import { Controller, Get, Inject, Patch, Post } from "@nestjs/common";
import { is, paginate } from "@livecoco/contracts";
import { C, Idempotent, Public, Shape, created, items, reqShape, termsShape, type Ctx } from "../../http/route-kit.ts";
import { LotsService } from "./lots.service.ts";
import { OffersService } from "./offers.service.ts";
import { RequirementsService } from "./requirements.service.ts";

/** Seller lots and the public market, buyer requirements and matching, offers and negotiation threads. */
@Controller("v1")
export class MarketplaceController {
  private readonly lots: LotsService;
  private readonly requirements: RequirementsService;
  private readonly offers: OffersService;
  constructor(@Inject(LotsService) lots: LotsService, @Inject(RequirementsService) requirements: RequirementsService, @Inject(OffersService) offers: OffersService) {
    this.lots = lots;
    this.requirements = requirements;
    this.offers = offers;
  }

  // ---- lots ----------------------------------------------------------------------------------
  @Get("sell-lots")
  @Public()
  async searchLots(@C() { s, query }: Ctx) {
    const f = Object.fromEntries(["productId", "originMarketId", "gradeGroup"].filter((k) => query.get(k)).map((k) => [k, query.get(k) as string]));
    const all = await this.lots.search(s, f);
    return paginate(all, query.get("cursor"), Math.min(Number(query.get("limit") ?? 20) || 20, 50), (l) => `${l.createdAt}|${l.sellLotId}`);
  }

  @Post("sell-lots")
  @Shape({ productId: is.string, gradeAttributes: is.object, gradeGroup: is.string, unit: is.string, quantityTotal: is.string, partialFulfilmentAllowed: is.bool, originMarketId: is.string, availableFrom: is.iso, availableTo: is.iso, expiresAt: is.iso, fulfilment: is.object, priceExpectation: is.object })
  @Idempotent()
  async createLot(@C() { s, body }: Ctx) {
    return created(await this.lots.create(s, body as never));
  }

  @Get("me/sell-lots")
  myLots(@C() { s }: Ctx) {
    return items(this.lots.mine(s));
  }

  @Get("sell-lots/:id")
  getLot(@C() { s, params }: Ctx) {
    return this.lots.own(s, params.id as string);
  }

  @Patch("sell-lots/:id")
  updateLot(@C() { s, params, body, ifMatch }: Ctx) {
    return this.lots.update(s, params.id as string, body, ifMatch);
  }

  @Post("sell-lots/:id/photos")
  addPhoto(@C() { s, params }: Ctx) {
    return this.lots.addPhoto(s, params.id as string);
  }

  @Post("sell-lots/:id/activate")
  @Idempotent()
  activate(@C() { s, params }: Ctx) {
    return this.lots.activate(s, params.id as string);
  }

  @Post("sell-lots/:id/withdraw")
  @Idempotent()
  withdraw(@C() { s, params }: Ctx) {
    return this.lots.withdraw(s, params.id as string);
  }

  @Get("sell-lots/:id/matches")
  lotMatches(@C() { s, params }: Ctx) {
    return items(this.requirements.matchesForLot(s, params.id as string));
  }

  // ---- requirements --------------------------------------------------------------------------
  @Post("buy-requirements")
  @Shape(reqShape)
  @Idempotent()
  async createRequirement(@C() { s, body }: Ctx) {
    return created(await this.requirements.create(s, body as never));
  }

  @Post("buy-requirements/recurring")
  @Shape({ ...reqShape, cadence: is.oneOf("WEEKLY", "FORTNIGHTLY", "MONTHLY"), occurrences: is.int })
  @Idempotent()
  async createRecurring(@C() { s, body }: Ctx) {
    return created(await this.requirements.createRecurring(s, body as never, body.cadence, body.occurrences));
  }

  @Get("me/buy-requirements")
  myRequirements(@C() { s }: Ctx) {
    return items(this.requirements.mine(s));
  }

  @Get("buy-requirements/:id/matches")
  requirementMatches(@C() { s, params }: Ctx) {
    return items(this.requirements.matchesForRequirement(s, params.id as string));
  }

  @Post("buy-requirements/:id/close")
  closeRequirement(@C() { s, params }: Ctx) {
    return this.requirements.close(s, params.id as string);
  }

  // ---- offers --------------------------------------------------------------------------------
  @Post("offers")
  @Shape({ sellLotId: is.string, ...termsShape })
  @Idempotent()
  async createOffer(@C() { s, body }: Ctx) {
    return created(await this.offers.create(s, body as never));
  }

  @Get("offers")
  myOffers(@C() { s }: Ctx) {
    return items(this.offers.mine(s));
  }

  @Post("offers/:id/counter")
  @Shape(termsShape)
  @Idempotent()
  async counter(@C() { s, params, body, ifMatch }: Ctx) {
    return created(await this.offers.counter(s, params.id as string, body.terms, body.expiresAt, ifMatch));
  }

  @Post("offers/:id/accept")
  @Idempotent()
  async accept(@C() { s, params, ifMatch }: Ctx) {
    return created(await this.offers.accept(s, params.id as string, ifMatch));
  }

  @Post("offers/:id/reject")
  reject(@C() { s, params }: Ctx) {
    return this.offers.reject(s, params.id as string);
  }

  @Post("offers/:id/withdraw")
  withdrawOffer(@C() { s, params }: Ctx) {
    return this.offers.withdraw(s, params.id as string);
  }

  @Post("threads/:id/contact-reveal")
  @Idempotent()
  revealContact(@C() { s, params }: Ctx) {
    return this.offers.revealContact(s, params.id as string);
  }
}
