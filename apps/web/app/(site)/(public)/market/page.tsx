import Link from "next/link";
import { money } from "../../../../lib/format.ts";
import { getApi, getLocale, getNames, getT } from "../../../_lib/server.ts";

export default async function MarketPage({ searchParams }: { searchParams: Promise<{ cursor?: string | string[] }> }) {
  const { cursor } = await searchParams;
  const [api, t, locale, names] = await Promise.all([getApi(), getT(), getLocale(), getNames()]);
  const lots = await api.marketLots(typeof cursor === "string" ? cursor : null);
  return (
    <>
      <h1>{t("market.title")}</h1>
      {lots.items.length ? null : <p>{t("common.none")}</p>}
      {lots.items.map((l) => (
        <article className="card" key={l.sellLotId}>
          <h2><Link href={`/market/${encodeURIComponent(l.sellLotId)}`}>{`${names.product(l.productId)} — ${l.quantityAvailable} ${l.unit} ${t("sell.available")}`}</Link></h2>
          <p className="hint">{`${names.market(l.originMarketId)} · ${l.gradeGroup} · ${l.fulfilment.mode} · ${"unitPricePaise" in l.priceExpectation ? money(locale, l.priceExpectation.unitPricePaise) : "—"}`}</p>
          <p className="hint">{l.verificationClaims.map((x) => t(x.displayLabelKey ?? `claim.${x.type}`)).join(", ") || "—"}</p>
          <Link className="btn" href={`/market/${encodeURIComponent(l.sellLotId)}`}>{t("market.offer")}</Link>
        </article>
      ))}
      {lots.page.hasMore && lots.page.nextCursor ? <p className="pager"><Link className="btn secondary" href={`/market?cursor=${encodeURIComponent(lots.page.nextCursor)}`}>→</Link></p> : null}
    </>
  );
}
