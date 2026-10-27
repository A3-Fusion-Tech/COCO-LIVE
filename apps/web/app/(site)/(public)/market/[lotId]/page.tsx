import Link from "next/link";
import { notFound } from "next/navigation";
import { money, when } from "../../../../../lib/format.ts";
import { opt } from "../../../../../lib/forms.ts";
import { ActionForm } from "../../../../_components/ActionForm.tsx";
import { Kv, Section } from "../../../../_components/ui.tsx";
import { getApi, getLocale, getMe, getNames, getT, loginHref } from "../../../../_lib/server.ts";
import { makeOffer } from "../actions.ts";
import { findMarketLot } from "../lots.ts";

export default async function LotPage({ params }: { params: Promise<{ lotId: string }> }) {
  const { lotId } = await params;
  const [api, t, locale, names, me] = await Promise.all([getApi(), getT(), getLocale(), getNames(), getMe()]);
  const lot = await findMarketLot(api, lotId);
  if (!lot) notFound();
  return (
    <>
      <p><Link href="/market">{`← ${t("common.back")}`}</Link></p>
      <h1>{`${names.product(lot.productId)} — ${lot.quantityAvailable} ${lot.unit} ${t("sell.available")}`}</h1>
      <Section title={t("market.lot")}>
        <Kv obj={{
          [t("sell.origin")]: names.market(lot.originMarketId),
          [t("sell.grade")]: lot.gradeGroup,
          ...lot.gradeAttributes,
          [`${t("sell.pickup")} / ${t("sell.delivery")}`]: lot.fulfilment.mode,
          [t("sell.costsIn")]: lot.fulfilment.costsIncluded.join(", ") || "—",
          [t("sell.costsEx")]: lot.fulfilment.costsExcluded.join(", ") || "—",
          [t("sell.price")]: "unitPricePaise" in lot.priceExpectation ? money(locale, lot.priceExpectation.unitPricePaise) : "—",
          [t("sell.from")]: when(locale, lot.availableFrom),
          [t("sell.to")]: when(locale, lot.availableTo),
          [t("offers.expires")]: when(locale, lot.expiresAt),
          [t("me.claims")]: lot.verificationClaims.map((x) => t(x.displayLabelKey ?? `claim.${x.type}`)).join(", ") || "—",
          ...(lot.listedOnBehalfOf ? { [t("sell.listedFor")]: lot.listedOnBehalfOf } : {}),
        }} />
      </Section>
      <Section title={t("market.offer")}>
        {me ? (
          <ActionForm action={makeOffer.bind(null, lot.sellLotId)} submit={t("market.offer")} fields={[
            { name: "qty", label: t("market.qty"), mode: "decimal", value: lot.quantityAvailable, required: true },
            { name: "price", label: t("market.unitPrice"), type: "number", required: true },
            { name: "hours", label: t("market.validHours"), type: "number", value: "24" },
            { name: "payment", label: t("market.payment"), type: "select", options: ["UPI", "CASH", "BANK_TRANSFER"].map((x) => opt(x)) },
            { name: "due", label: t("market.paymentDue"), type: "select", options: ["ON_LOADING", "ON_DELIVERY", "WITHIN_3_DAYS", "WITHIN_7_DAYS"].map((x) => opt(x)) },
            { name: "weigh", label: t("market.weighment"), type: "select", options: ["COUNT", "SCALE", "WEIGHBRIDGE"].map((x) => opt(x)) },
          ]} />
        ) : <p><Link className="btn" href={loginHref(`/market/${encodeURIComponent(lot.sellLotId)}`)}>{t("market.signInToOffer")}</Link></p>}
      </Section>
    </>
  );
}
