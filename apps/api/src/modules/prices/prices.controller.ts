import { Controller, Get, Inject, Patch, Post } from "@nestjs/common";
import { MARKETS, PRODUCTS } from "@livecoco/domain";
import { is } from "@livecoco/contracts";
import { C, Idempotent, Public, Shape, alertShape, created, items, money, type Ctx } from "../../http/route-kit.ts";
import { AlertsService } from "./alerts.service.ts";
import { PricesService } from "./prices.service.ts";

const bucketQuery = (q: URLSearchParams) => [q.get("productId") ?? "", q.get("marketId") ?? "", q.get("unit") ?? "", q.get("stage") ?? ""] as const;

/** The public price board and catalog, contributor quotes and price alerts. */
@Controller("v1")
export class PricesController {
  private readonly prices: PricesService;
  private readonly alerts: AlertsService;
  constructor(@Inject(PricesService) prices: PricesService, @Inject(AlertsService) alerts: AlertsService) {
    this.prices = prices;
    this.alerts = alerts;
  }

  @Get("catalog")
  @Public()
  catalog() {
    return { products: Object.values(PRODUCTS).filter((x) => x.enabled), markets: Object.values(MARKETS).map(({ marketId, name, areaId }) => ({ marketId, name, areaId })) };
  }

  @Get("prices/latest")
  @Public()
  async latest(@C() { s, query }: Ctx) {
    const filter = Object.fromEntries(["productId", "marketId", "stage", "unit", "gradeGroup"].filter((k) => query.get(k)).map((k) => [k, query.get(k)]));
    return { items: await this.prices.latestPrices(s, filter), disclaimerKey: "price.not_offer" };
  }

  @Get("prices/evidence")
  @Public()
  evidence(@C() { s, query }: Ctx) {
    return this.prices.priceEvidence(s, ...bucketQuery(query));
  }

  @Get("prices/history")
  @Public()
  history(@C() { s, query }: Ctx) {
    return items(this.prices.priceHistory(s, ...bucketQuery(query)));
  }

  @Get("prices/msp")
  @Public()
  msp() {
    return { items: this.prices.mspReferences() };
  }

  @Post("contributor/quotes")
  @Shape({ productId: is.string, marketId: is.string, gradeGroup: is.string, unit: is.string, stage: is.string, tradeTerm: is.string, lowPaise: money, highPaise: money, observedAt: is.iso, organizationId: is.string })
  @Idempotent()
  async submitQuote(@C() { s, body }: Ctx) {
    return created(await this.prices.submitQuote(s, body as never));
  }

  @Post("contributor/observations/:id/correction")
  @Shape({ lowPaise: money, highPaise: money, reason: is.string })
  @Idempotent()
  correct(@C() { s, params, body }: Ctx) {
    return this.prices.correctObservation(s, params.id as string, { lowPaise: body.lowPaise, highPaise: body.highPaise, ...(body.referencePaise !== undefined ? { referencePaise: body.referencePaise } : {}) }, body.reason);
  }

  @Post("alerts")
  @Shape(alertShape)
  @Idempotent()
  createAlert(@C() { s, body }: Ctx) {
    return created(this.alerts.create(s, body as never));
  }

  @Get("alerts")
  myAlerts(@C() { s }: Ctx) {
    return items(this.alerts.mine(s));
  }

  @Patch("alerts/:id")
  @Shape({ status: is.oneOf("ACTIVE", "PAUSED", "CANCELLED") })
  setAlertStatus(@C() { s, params, body }: Ctx) {
    return this.alerts.setStatus(s, params.id as string, body.status);
  }
}
