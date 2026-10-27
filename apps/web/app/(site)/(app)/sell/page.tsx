import Link from "next/link";
import { when } from "../../../../lib/format.ts";
import { opt, type FieldSpec } from "../../../../lib/forms.ts";
import { ActionForm } from "../../../_components/ActionForm.tsx";
import { Badge, Empty, Section } from "../../../_components/ui.tsx";
import { getApi, getLocale, getNames, getT, requireMe } from "../../../_lib/server.ts";
import { activateLot, withdrawLot } from "./actions.ts";
import { PhotoUpload } from "./PhotoUpload.tsx";
import { QUALITY_FIELDS } from "./quality.ts";
import { SellLotForm } from "./SellLotForm.tsx";

export default async function SellPage() {
  await requireMe();
  const [api, t, locale, names] = await Promise.all([getApi(), getT(), getLocale(), getNames()]);
  const mine = await api.mySellLots();
  const lotFields = (productId: string): FieldSpec[] => [
    { name: "productId", label: t("sell.product"), type: "select", value: productId, options: names.productOptions() },
    ...(QUALITY_FIELDS[productId] ?? []).map((q) => ({ name: q.name, label: t(q.labelKey), value: q.value })),
    { name: "unit", label: t("sell.unit"), type: "select", options: names.unitOptions(productId) },
    { name: "quantity", label: t("sell.quantity"), mode: "decimal", required: true },
    { name: "gradeGroup", label: t("sell.grade"), value: "FAQ" },
    { name: "origin", label: t("sell.origin"), type: "select", options: names.marketOptions() },
    { name: "price", label: t("sell.price"), type: "number" },
    { name: "from", label: t("sell.from"), type: "datetime-local", required: true },
    { name: "to", label: t("sell.to"), type: "datetime-local", required: true },
    { name: "expires", label: t("sell.expires"), type: "datetime-local", required: true },
    { name: "mode", label: `${t("sell.pickup")} / ${t("sell.delivery")}`, type: "select", options: [opt("PICKUP", t("sell.pickup")), opt("DELIVERY", t("sell.delivery"))] },
    { name: "costsIn", label: t("sell.costsIn"), value: "LOADING" },
    { name: "costsEx", label: t("sell.costsEx"), value: "TRANSPORT" },
    { name: "partial", label: t("sell.partial"), type: "checkbox", value: true },
    { name: "onBehalf", label: t("sell.listedFor") },
  ];
  const fieldsByProduct = Object.fromEntries(names.catalog.products.map((p) => [p.productId, lotFields(p.productId)]));
  return (
    <>
      <h1>{t("sell.title")}</h1>
      <Section title={t("sell.new")}>
        <SellLotForm fieldsByProduct={fieldsByProduct} initialProduct="prod_mature_coconut" submit={t("common.create")} />
      </Section>
      <h2>{t("sell.mine")}</h2>
      {mine.items.length ? mine.items.map((l) => (
        <div className="card" key={l.sellLotId}>
          <h2>{`${names.product(l.productId)} — ${l.quantityTotal} ${l.unit}`}</h2>
          <Badge t={t} status={l.status} />
          <p className="hint">{`${names.market(l.originMarketId)} · ${t("offers.expires")} ${when(locale, l.expiresAt)} · ${t("sell.reserved")} ${l.quantityReserved} · 📷 ${l.photoCount}`}</p>
          <div className="row">
            <PhotoUpload lotId={l.sellLotId} label={t("sell.photo")} done={t("sell.photoOk")} failed={t("err.generic")} />
            {l.status === "DRAFT" ? <ActionForm action={activateLot.bind(null, l.sellLotId)} submit={t("sell.activate")} /> : null}
            {["DRAFT", "ACTIVE", "PENDING_REVIEW"].includes(l.status) ? <ActionForm action={withdrawLot.bind(null, l.sellLotId)} submit={t("sell.withdraw")} variant="danger" /> : null}
            <Link className="btn secondary" href={`/sell/${encodeURIComponent(l.sellLotId)}`}>{t("sell.matches")}</Link>
          </div>
        </div>
      )) : <Empty t={t} />}
    </>
  );
}
