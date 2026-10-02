import { Controller, Get } from "@nestjs/common";
import { MARKETS, PRODUCTS } from "../../../../../packages/domain/src/index.ts";
import { paginate } from "../../../../../packages/contracts/src/index.ts";
import { C, Public, type Ctx } from "../route-kit.ts";

/** Public price board: products, markets, latest and historical prices, bulletins and the anonymised price evidence. */
@Controller("v1")
export class CatalogController {
  @Get("prices/latest")
  @Public()
  getPricesLatest(@C() { p, query }: Ctx) {
    return ({ items: p.latestPrices(Object.fromEntries(["productId", "marketId", "stage", "unit", "gradeGroup"].filter((k) => query.get(k)).map((k) => [k, query.get(k)]))), disclaimerKey: "price.not_offer" });
  }

  @Get("prices/evidence")
  @Public()
  getPricesEvidence(@C() { p, query }: Ctx) {
    return p.priceEvidence(query.get("productId") ?? "", query.get("marketId") ?? "", query.get("unit") ?? "", query.get("stage") ?? "");
  }

  @Get("prices/history")
  @Public()
  getPricesHistory(@C() { p, query }: Ctx) {
    return ({ items: p.priceHistory(query.get("productId") ?? "", query.get("marketId") ?? "", query.get("unit") ?? "", query.get("stage") ?? "") });
  }

  @Get("prices/msp")
  @Public()
  getPricesMsp(@C() { p }: Ctx) {
    return ({ items: p.mspReferences() });
  }

  @Get("sell-lots")
  @Public()
  getSellLots(@C() { p, query }: Ctx) {
    const all = p.searchLots({ ...(query.get("productId") ? { productId: query.get("productId") as string } : {}), ...(query.get("originMarketId") ? { originMarketId: query.get("originMarketId") as string } : {}), ...(query.get("gradeGroup") ? { gradeGroup: query.get("gradeGroup") as string } : {}) });
    return paginate(all, query.get("cursor"), Math.min(Number(query.get("limit") ?? 20) || 20, 50), (l) => `${l.createdAt}|${l.sellLotId}`);
  }

  @Get("catalog")
  @Public()
  getCatalog() {
    return ({ products: Object.values(PRODUCTS).filter((x) => x.enabled), markets: Object.values(MARKETS).map(({ marketId, name, areaId }) => ({ marketId, name, areaId })) });
  }
}
