import { money, when } from "../../../../../lib/format.ts";
import { getApi, getLocale, getNames, getT, load } from "../../../../_lib/server.ts";

type Query = Record<"productId" | "marketId" | "unit" | "stage", string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");

/** Contributor-anonymous evidence behind one published price (`/prices/evidence?productId=&marketId=&unit=&stage=`). */
export default async function EvidencePage({ searchParams }: { searchParams: Promise<Query> }) {
  const q = await searchParams;
  const bucket = { productId: one(q.productId), marketId: one(q.marketId), unit: one(q.unit), stage: one(q.stage) };
  const [api, t, locale, names] = await Promise.all([getApi(), getT(), getLocale(), getNames()]);
  const ev = await load(api.priceEvidence(bucket));
  return (
    <>
      <p><a href="/">{`← ${t("nav.prices")}`}</a></p>
      <h1>{t("prices.evidenceTitle")}</h1>
      <p>{`${names.product(bucket.productId)} · ${names.market(bucket.marketId)} · ${t(`stage.${bucket.stage}`)} · ${t(`unit.${bucket.unit}`)}`}</p>
      <p className="hint">{`${ev.calculationVersion} · ${when(locale, ev.calculatedAt)}`}</p>
      <table>
        <thead><tr><th scope="col">{t("common.status")}</th><th scope="col">{t("prices.reported")}</th><th scope="col">{`${t("price.low")}–${t("price.high")}`}</th></tr></thead>
        <tbody>{ev.observations.map((o, n) => (
          <tr key={n}><td>{o.sourceClass}</td><td>{when(locale, o.observedAt)}</td><td>{`${money(locale, o.range.low.amountPaise)}–${money(locale, o.range.high.amountPaise)}`}</td></tr>
        ))}</tbody>
      </table>
      <p className="note" role="note">{t("price.not_offer")}</p>
    </>
  );
}
