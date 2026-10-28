import { notFound } from "next/navigation";
import { isLocale, otherLocale, translator } from "../../../lib/i18n/index.ts";
import { mspLine, priceCardView } from "../../../lib/prices.ts";
import { PriceCard } from "../../_components/ui.tsx";
import { publicApi } from "../../_lib/server.ts";

/**
 * The public price board, a server component regenerated at most once a minute (ISR: responses carry
 * `s-maxage=60, stale-while-revalidate`). Pages are generated on first request rather than at build time,
 * when the API is not reachable. If a regeneration fails because the API is down, the last good page keeps
 * being served; with no good page yet, `error.tsx` shows the "temporarily unavailable" state.
 */
export const revalidate = 60;
export const dynamicParams = true;
export const generateStaticParams = () => [];

export default async function PriceBoardPage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const t = translator(lang);
  const api = publicApi();
  const [prices, msp, catalog] = await Promise.all([api.latestPrices({ revalidate }), api.msp({ revalidate }), api.catalog({ revalidate: 3600 })]);
  const other = otherLocale(lang);
  return (
    <>
      <header className="top">
        <a className="brand" href="/">LiveCoco</a>
        <nav aria-label="Main">
          <a href="/market">{t("nav.market")}</a>
          <a href="/login">{t("prices.openApp")}</a>
        </nav>
        <a id="lang" className="btn secondary" href={`/?lang=${other}`} hrefLang={other} lang={other}>{other === "ta" ? "தமிழ்" : "English"}</a>
      </header>
      <main id="main">
        <h1>{t("price.title")}</h1>
        <p className="note" role="note">{t("price.not_offer")}</p>
        {prices.items.length
          ? <div className="grid">{prices.items.map((i) => { const v = priceCardView(i, lang); return <PriceCard key={v.key} v={v} t={t} />; })}</div>
          : <p>{t("prices.none")}</p>}
        <aside aria-labelledby="msp">
          <h2 id="msp">MSP</h2>
          <p className="hint">{t("price.msp_note")}</p>
          <ul>{msp.items.map((m) => <li key={`${m.productId}/${m.unit}/${m.seasonLabel}`}>{mspLine(m, lang, catalog)}</li>)}</ul>
        </aside>
      </main>
    </>
  );
}
