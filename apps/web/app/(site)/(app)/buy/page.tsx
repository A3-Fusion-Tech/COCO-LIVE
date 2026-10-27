import Link from "next/link";
import { when } from "../../../../lib/format.ts";
import { opt } from "../../../../lib/forms.ts";
import { ActionForm } from "../../../_components/ActionForm.tsx";
import { Badge, Empty, Section } from "../../../_components/ui.tsx";
import { getApi, getLocale, getNames, getT, requireMe } from "../../../_lib/server.ts";
import { closeRequirement, createRequirement } from "./actions.ts";

export default async function BuyPage() {
  const me = await requireMe();
  const [api, t, locale, names] = await Promise.all([getApi(), getT(), getLocale(), getNames()]);
  const mine = await api.myBuyRequirements();
  const verified = me.claims.some((x) => ["PERSON_IDENTITY", "ORGANIZATION_EXISTENCE"].includes(x.type));
  return (
    <>
      <h1>{t("buy.title")}</h1>
      {verified ? null : <p className="note">{t("buy.verifyFirst")}</p>}
      <Section title={t("buy.new")}>
        <ActionForm action={createRequirement} submit={t("common.create")} fields={[
          { name: "productId", label: t("sell.product"), type: "select", options: names.productOptions() },
          { name: "unit", label: t("sell.unit"), type: "select", options: names.unitOptions() },
          { name: "target", label: t("buy.target"), mode: "decimal", required: true },
          { name: "min", label: t("buy.min"), mode: "decimal" },
          { name: "gradeGroup", label: t("sell.grade"), value: "FAQ" },
          { name: "dest", label: t("buy.dest"), type: "select", options: names.marketOptions() },
          { name: "radius", label: t("buy.radius"), type: "number", value: "40" },
          { name: "from", label: t("sell.from"), type: "datetime-local", required: true },
          { name: "by", label: t("buy.by"), type: "datetime-local", required: true },
          { name: "expires", label: t("sell.expires"), type: "datetime-local", required: true },
          { name: "maxPrice", label: t("buy.maxPrice"), type: "number" },
          { name: "repeat", label: t("buy.recurring"), type: "select", options: [opt("", t("buy.once")), opt("WEEKLY"), opt("FORTNIGHTLY"), opt("MONTHLY")] },
          { name: "times", label: t("buy.occurrences"), type: "number", value: "4" },
          { name: "partial", label: t("sell.partial"), type: "checkbox", value: true },
        ]} />
      </Section>
      {mine.items.length ? mine.items.map((r) => (
        <div className="card" key={r.requirementId}>
          <h2>{`${names.product(r.productId)} — ${r.targetQuantity} ${r.unit}`}</h2>
          <Badge t={t} status={r.status} />
          <p className="hint">{`${names.market(r.destination.marketId)} · ${when(locale, r.requiredBy)}`}</p>
          <div className="row">
            <Link className="btn secondary" href={`/buy/${encodeURIComponent(r.requirementId)}`}>{t("buy.matches")}</Link>
            {["ACTIVE", "DRAFT"].includes(r.status) ? <ActionForm action={closeRequirement.bind(null, r.requirementId)} submit={t("buy.close")} variant="danger" /> : null}
          </div>
        </div>
      )) : <Empty t={t} />}
    </>
  );
}
