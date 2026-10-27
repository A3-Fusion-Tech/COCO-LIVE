import type { ApiClient } from "../../../../lib/api/client.ts";
import type { Inspection, Partner, PartnerSla, TransportRequest } from "../../../../lib/api/types.ts";
import { when } from "../../../../lib/format.ts";
import { opt } from "../../../../lib/forms.ts";
import type { Locale, Translate } from "../../../../lib/i18n/index.ts";
import { ActionForm } from "../../../_components/ActionForm.tsx";
import { Badge, Empty, Kv, Section } from "../../../_components/ui.tsx";
import { getApi, getLocale, getNames, getT, requireMe } from "../../../_lib/server.ts";
import { acceptInspection, applyAsPartner, quoteTransport, submitInspectionResult, updateTransportStatus } from "./actions.ts";

const NEXT_TRANSPORT_STATUS = { BOOKED: "PICKED_UP", PICKED_UP: "IN_TRANSIT", IN_TRANSIT: "DELIVERED" } as const;
type Names = Awaited<ReturnType<typeof getNames>>;

interface Workspace { partner: Partner; sla: PartnerSla; inspections: Inspection[]; open: TransportRequest[]; jobs: TransportRequest[] }

async function loadWorkspace(api: ApiClient, partner: Partner): Promise<Workspace> {
  const none = { items: [] as TransportRequest[] };
  const [sla, inspections, open, jobs] = await Promise.all([
    api.partnerSla(partner.partnerId),
    partner.kind === "INSPECTION" ? api.partnerInspections() : Promise.resolve({ items: [] as Inspection[] }),
    partner.kind === "LOGISTICS" ? api.partnerTransportRequests() : Promise.resolve(none),
    partner.kind === "LOGISTICS" ? api.partnerTransportJobs() : Promise.resolve(none),
  ]);
  return { partner, sla, inspections: inspections.items, open: open.items, jobs: jobs.items };
}

/** Inspection and logistics partners: apply, then work inspection jobs or quote and run transport. */
export default async function PartnerPage() {
  await requireMe();
  const [api, t, locale, names] = await Promise.all([getApi(), getT(), getLocale(), getNames()]);
  const [orgs, mine] = await Promise.all([api.myOrganizations(), api.myPartners()]);
  const unapplied = orgs.items.filter((o) => o.kind.endsWith("_PARTNER") && !mine.items.some((p) => p.organizationId === o.organizationId));
  const workspaces = await Promise.all(mine.items.filter((p) => p.status === "APPROVED").map((p) => loadWorkspace(api, p)));
  return (
    <>
      <h1>{t("partner.title")}</h1>
      {unapplied.length ? (
        <Section title={t("partner.apply")}>
          <ActionForm action={applyAsPartner} submit={t("partner.apply")} fields={[
            { name: "organizationId", label: t("nav.org"), type: "select", options: unapplied.map((o) => opt(o.organizationId, `${o.name} (${o.kind})`)) },
            { name: "markets", label: t("partner.markets"), value: "market_pollachi" },
          ]} />
        </Section>
      ) : null}
      {mine.items.map((p) => <div className="card" key={p.partnerId}><b>{`${p.kind} — ${p.partnerId}`}</b> <Badge t={t} status={p.status} /></div>)}
      {!mine.items.length && !unapplied.length ? <Empty t={t} /> : null}
      {workspaces.map((w) => <PartnerWorkspace key={w.partner.partnerId} w={w} t={t} locale={locale} names={names} />)}
    </>
  );
}

function PartnerWorkspace({ w, t, locale, names }: { w: Workspace; t: Translate; locale: Locale; names: Names }) {
  return (
    <>
      <Section title={t("partner.sla")}><Kv obj={{ inspections: w.sla.inspections, transport: w.sla.transport }} /></Section>
      {w.partner.kind === "INSPECTION" ? <>
        <h2>{t("partner.inspections")}</h2>
        {w.inspections.length ? w.inspections.map((i) => (
          <div className="card" key={i.inspectionId}>
            <b>{`${i.location} — ${when(locale, i.scheduledAt)}`}</b> <Badge t={t} status={i.status} />
            {i.status === "REQUESTED" ? <ActionForm action={acceptInspection.bind(null, i.inspectionId)} submit={t("partner.accept")} /> : null}
            {i.status === "SCHEDULED" ? (
              <ActionForm action={submitInspectionResult.bind(null, i.inspectionId)} submit={t("partner.result")} fields={[
                { name: "outcome", label: t("partner.outcome"), type: "select", options: ["PASS", "FAIL", "CONDITIONAL"].map((x) => opt(x)) },
                { name: "m", label: t("partner.measure"), value: "sampleSize:100" },
                { name: "note", label: t("partner.note"), required: true },
              ]} />
            ) : null}
          </div>
        )) : <Empty t={t} />}
      </> : <>
        <h2>{t("partner.open")}</h2>
        {w.open.length ? w.open.map((r) => (
          <div className="card" key={r.requestId}>
            <b>{`${names.market(r.pickupMarketId)} → ${names.market(r.destinationMarketId)} · ${r.weightKg} kg`}</b>
            <ActionForm action={quoteTransport.bind(null, r.requestId)} submit={t("partner.quote")} fields={[
              { name: "price", label: t("partner.price"), type: "number", required: true },
              { name: "vehicle", label: t("partner.vehicle"), value: "LCV" },
              { name: "eta", label: t("partner.eta"), type: "datetime-local", required: true },
            ]} />
          </div>
        )) : <Empty t={t} />}
        {w.jobs.filter((j) => j.status !== "DELIVERED").map((j) => {
          const next = j.status in NEXT_TRANSPORT_STATUS ? NEXT_TRANSPORT_STATUS[j.status as keyof typeof NEXT_TRANSPORT_STATUS] : null;
          return (
            <div className="card" key={`job/${j.requestId}`}>
              <b>{`${j.requestId} — ${j.status}`}</b>
              {next ? <ActionForm action={updateTransportStatus.bind(null, j.requestId, next)} submit={`${t("partner.status")}: ${next}`} /> : null}
            </div>
          );
        })}
      </>}
    </>
  );
}
