import { money } from "../../../../lib/format.ts";
import { opt } from "../../../../lib/forms.ts";
import { ActionForm } from "../../../_components/ActionForm.tsx";
import { Badge, Empty, Section } from "../../../_components/ui.tsx";
import { getApi, getLocale, getNames, getT, requireMe } from "../../../_lib/server.ts";
import { createAlert, setAlertStatus } from "./actions.ts";

type Query = Record<"productId" | "marketId" | "unit" | "stage", string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");
const STAGES = ["FARM_GATE", "REGULATED_MARKET", "WHOLESALE", "PROCESSOR_PURCHASE", "RETAIL"];

/** Price alerts: the user's subscriptions, and a form prefilled from the price card that linked here. */
export default async function AlertsPage({ searchParams }: { searchParams: Promise<Query> }) {
  await requireMe();
  const q = await searchParams;
  const [api, t, locale, names] = await Promise.all([getApi(), getT(), getLocale(), getNames()]);
  const alerts = await api.alerts();
  const live = alerts.items.filter((a) => a.status !== "CANCELLED");
  return (
    <>
      <h1>{t("prices.myAlerts")}</h1>
      {live.length ? live.map((a) => (
        <div className="card" key={a.alertId}>
          <p>{`${names.product(a.productId)} · ${names.market(a.marketId)} · ${t(`stage.${a.stage}`)} · ${a.direction === "ABOVE" ? t("prices.above") : a.direction === "BELOW" ? t("prices.below") : a.direction} ${a.thresholdPaise ? money(locale, a.thresholdPaise) : ""} / ${t(`unit.${a.unit}`)}`} <Badge t={t} status={a.status} /></p>
          <div className="forms">
            <ActionForm action={setAlertStatus.bind(null, a.alertId, a.status === "PAUSED" ? "ACTIVE" : "PAUSED")} submit={a.status === "PAUSED" ? t("prices.resume") : t("prices.pause")} variant="secondary" />
            <ActionForm action={setAlertStatus.bind(null, a.alertId, "CANCELLED")} submit={t("prices.cancel")} variant="danger" />
          </div>
        </div>
      )) : <Empty t={t} />}
      <Section title={t("prices.alert")}>
        <ActionForm action={createAlert} submit={t("common.save")} fields={[
          { name: "productId", label: t("sell.product"), type: "select", options: names.productOptions(), value: one(q.productId) },
          { name: "marketId", label: t("sell.origin"), type: "select", options: names.marketOptions(), value: one(q.marketId) },
          { name: "stage", label: t("prices.stage"), type: "select", options: STAGES.map((s) => opt(s, t(`stage.${s}`))), value: one(q.stage) || "FARM_GATE" },
          { name: "unit", label: t("sell.unit"), type: "select", options: names.unitOptions(), value: one(q.unit) },
          { name: "direction", label: t("prices.direction"), type: "select", options: [opt("ABOVE", t("prices.above")), opt("BELOW", t("prices.below"))] },
          { name: "threshold", label: t("prices.threshold"), type: "number", required: true },
          { name: "channel", label: t("prices.channel"), type: "select", options: [opt("SMS"), opt("WHATSAPP", "WhatsApp"), opt("PUSH", "Push")] },
          { name: "consent", label: t("prices.consent"), type: "checkbox" },
        ]} />
      </Section>
    </>
  );
}
