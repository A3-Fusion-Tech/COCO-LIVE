import Link from "next/link";
import { money, when } from "../../../../lib/format.ts";
import { ActionForm } from "../../../_components/ActionForm.tsx";
import { Badge, Empty } from "../../../_components/ui.tsx";
import { getApi, getLocale, getT, requireMe } from "../../../_lib/server.ts";
import { acceptOffer, counterOffer, rejectOffer, withdrawOffer } from "./actions.ts";

/** Open offers (accept, reject, counter or withdraw) and the user's deals. */
export default async function DealsPage() {
  const me = await requireMe();
  const [api, t, locale] = await Promise.all([getApi(), getT(), getLocale()]);
  const [offers, deals] = await Promise.all([api.offers(), api.deals()]);
  return (
    <>
      <h1>{t("offers.title")}</h1>
      {offers.items.length ? null : <Empty t={t} />}
      {offers.items.map((o) => {
        const mine = o.createdByPartyId === me.userId;
        return (
          <div className="card" key={o.offerId}>
            <h2>{`${o.terms.quantity} ${o.terms.unit} @ ${money(locale, o.terms.unitPricePaise)}`}</h2>
            <Badge t={t} status={o.status} />
            <p className="hint">{`${t("offers.revision")} ${o.revision} · ${t("offers.expires")} ${when(locale, o.expiresAt)} · ${t("offers.total")} ${money(locale, o.estimatedTotalPaise)}`}</p>
            {o.status === "ACTIVE" ? (
              <div className="forms">
                {mine ? <ActionForm action={withdrawOffer.bind(null, o.offerId)} submit={t("offers.withdraw")} variant="danger" /> : <>
                  <ActionForm action={acceptOffer.bind(null, o.offerId)} submit={t("offers.accept")} />
                  <ActionForm action={rejectOffer.bind(null, o.offerId)} submit={t("offers.reject")} variant="danger" />
                </>}
              </div>
            ) : null}
            {o.status === "ACTIVE" && !mine ? (
              <details>
                <summary>{t("offers.counter")}</summary>
                <ActionForm action={counterOffer.bind(null, o.offerId)} submit={t("offers.counter")} fields={[
                  { name: "price", label: t("market.unitPrice"), type: "number", required: true },
                  { name: "hours", label: t("market.validHours"), type: "number", value: "24" },
                ]} />
              </details>
            ) : null}
          </div>
        );
      })}
      <h1>{t("deals.title")}</h1>
      {deals.items.length ? deals.items.map((d) => {
        const card = d.cards.at(-1);
        return (
          <Link key={d.dealId} className="card linkcard" href={`/deals/${encodeURIComponent(d.dealId)}`}>
            <b>{card ? `${card.terms.quantity} ${card.terms.unit} @ ${money(locale, card.terms.unitPricePaise)}` : d.dealId}</b> <Badge t={t} status={d.status} />
          </Link>
        );
      }) : <Empty t={t} />}
    </>
  );
}
