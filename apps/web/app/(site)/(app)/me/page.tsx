import { opt } from "../../../../lib/forms.ts";
import { ActionForm } from "../../../_components/ActionForm.tsx";
import { Empty, Section } from "../../../_components/ui.tsx";
import { getApi, getNames, getT, requireMe } from "../../../_lib/server.ts";
import { logout } from "../../(public)/login/actions.ts";
import { createOrganization, submitClaim, updateProfile } from "./actions.ts";

const CLAIM_TYPES = ["PERSON_IDENTITY", "ORGANIZATION_EXISTENCE", "BUSINESS_DOCUMENT", "GST_DOCUMENT", "FSSAI_DOCUMENT", "PRICE_CONTRIBUTOR_SCOPE"];
const ORG_KINDS = ["FPO", "FARMER_GROUP", "TRADER", "PROCESSOR", "BUYER", "INSPECTION_PARTNER", "LOGISTICS_PARTNER"];

/** Profile, verification claims, organizations and sign-out. */
export default async function AccountPage() {
  const me = await requireMe();
  const [api, t, names] = await Promise.all([getApi(), getT(), getNames()]);
  const orgs = await api.myOrganizations();
  return (
    <>
      <h1>{t("me.title")}</h1>
      <Section title={t("me.title")}>
        <ActionForm action={updateProfile} submit={t("common.save")} fields={[
          { name: "displayName", label: t("me.name"), value: me.displayName },
          { name: "actingAs", label: t("me.acting"), type: "select", value: me.actingAs, options: [opt("INDEPENDENT", t("me.independent")), opt("ORGANIZATION", t("me.organization"))] },
          { name: "locale", label: t("me.language"), type: "select", value: me.locale, options: [opt("ta", "தமிழ்"), opt("en", "English")] },
        ]} />
      </Section>
      <Section title={t("me.claims")}>
        {me.claims.length ? <ul>{me.claims.map((c) => <li key={c.type}>{`${t(c.displayLabelKey ?? `claim.${c.type}`)} — ${c.status}`}</li>)}</ul> : <p className="hint">{t("me.claimNone")}</p>}
        <ActionForm action={submitClaim} submit={t("me.claimSubmit")} fields={[
          { name: "type", label: t("me.claimType"), type: "select", options: CLAIM_TYPES.map((x) => opt(x)) },
          { name: "evidence", label: t("me.claimEvidence"), required: true },
          { name: "marketId", label: t("me.contributorMarket"), type: "select", options: [opt("", "—"), ...names.marketOptions()] },
          { name: "productId", label: t("me.contributorProduct"), type: "select", options: [opt("", "—"), ...names.productOptions()] },
        ]} />
      </Section>
      <Section title={t("nav.org")}>
        {orgs.items.length ? <ul>{orgs.items.map((o) => <li key={o.organizationId}>{`${o.name} — ${o.kind} (${o.role ?? ""})`}</li>)}</ul> : <Empty t={t} />}
        <ActionForm action={createOrganization} submit={t("me.orgCreate")} fields={[
          { name: "name", label: t("me.orgName"), required: true },
          { name: "kind", label: t("me.orgKind"), type: "select", options: ORG_KINDS.map((k) => opt(k)) },
        ]} />
      </Section>
      <form action={logout}><button type="submit" className="secondary">{t("common.logout")}</button></form>
    </>
  );
}
