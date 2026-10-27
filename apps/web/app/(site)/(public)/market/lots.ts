import type { ApiClient } from "../../../../lib/api/client.ts";
import type { MarketLot } from "../../../../lib/api/types.ts";

/** The API has no public single-lot read, so a lot is looked up in the market listing (50 per page). */
export async function findMarketLot(api: ApiClient, id: string, maxPages = 20): Promise<MarketLot | undefined> {
  let cursor: string | null = null;
  for (let n = 0; n < maxPages; n++) {
    const page = await api.marketLots(cursor);
    const lot = page.items.find((l) => l.sellLotId === id);
    if (lot || !page.page.hasMore) return lot;
    cursor = page.page.nextCursor;
  }
  return undefined;
}
