import Link from "next/link";
import { notFound } from "next/navigation";
import type { ApiClient } from "../../../../../lib/api/client.ts";
import type { List, TransportQuote } from "../../../../../lib/api/types.ts";
import { money, rupees, when } from "../../../../../lib/format.ts";
import { opt } from "../../../../../lib/forms.ts";
import { ActionForm } from "../../../../_components/ActionForm.tsx";
import { Badge, Empty, Kv, Section } from "../../../../_components/ui.tsx";
import { getApi, getLocale, getNames, getT, load, requireMe } from "../../../../_lib/server.ts";
import {
  addEvidence, bookQuote, cancelDeal, confirmDelivery, confirmPayment, dealStep, decideInspection, openDispute, proposeAmendment,
  requestInspection, requestTransport, respondAmendment, respondDispute,
} from "../actions.ts";

const DISPUTE_REASONS = ["QUANTITY_VARIANCE", "QUALITY_MISMATCH", "DAMAGE", "DELIVERY_FAILURE", "UNDISCLOSED_DEDUCTION", "NON_PAYMENT", "NO_SHOW"];
const quotesFor = (api: ApiClient, requestId: string | undefined): Promise<List<TransportQuote> | null> =>
  requestId ? api.transportQuotes(requestId).catch(() => null) : Promise.resolve(null);

/** Deal Card, the actions open to this party in the current state, inspection, transport, dispute and the timeline. */
export default async function DealPage({ params, searchParams }: { params: Promise<{ dealId: string }>; searchParams: Promise<{ transport?: string | string[] }> }) {
  const me = await requireMe();
  const [{ dealId }, { transport }] = await Promise.all([params, searchParams]);
  const [api, t, locale, names] = await Promise.all([getApi(), getT(), getLocale(), getNames()]);
  const d = await load(api.deal(dealId));
  const card = d.cards.at(-1);
  if (!card) notFound();
  const s = d.status;
  const seller = d.sellerId === me.userId;
  const buyer = d.buyerId === me.userId;
  const [partners, inspections, dispute, quotes] = await Promise.all([
    s === "AGREED" ? api.partners("INSPECTION") : Promise.resolve({ items: [] }),
    api.dealInspections(dealId).catch(() => ({ items: [] })),
    d.disputeId ? api.dispute(d.disputeId).catch(() => null) : Promise.resolve(null),
    quotesFor(api, typeof transport === "string" ? transport : undefined),
  ]);
  const step = (label: string, which: "pickup" | "accept" | "complete") => <ActionForm action={dealStep.bind(null, dealId, which)} submit={label} />;
  return (
    <>
      <p><Link href="/deals">{`← ${t("common.back")}`}</Link></p>
      <h1>{t("deals.title")}</h1>
      <Badge t={t} status={s} />
      <p className="note">{t("deals.noGuarantee")}</p>
      <Section title={`${t("deals.card")} #${card.revision}`}>
        <Kv obj={{
          [t("sell.quantity")]: `${card.terms.quantity} ${card.terms.unit}`,
          [t("market.unitPrice")]: money(locale, card.terms.unitPricePaise),
          [t("offers.total")]: money(locale, card.totalPaise),
          [t("market.payment")]: `${card.terms.paymentMethod} / ${card.terms.paymentDue}`,
          [t("market.weighment")]: card.terms.weighmentMethod,
          [t("sell.costsIn")]: card.terms.costsIncluded.join(", "),
          [t("sell.costsEx")]: card.terms.costsExcluded.join(", "),
        }} />
      </Section>

      <div className="card forms">
        {s === "AGREED" ? step(t("deals.pickup"), "pickup") : null}
        {seller && ["AGREED", "PICKUP_CONFIRMED"].includes(s)
          ? <ActionForm action={confirmDelivery.bind(null, dealId)} submit={t("deals.deliver")} fields={[{ name: "actualQuantity", label: t("deals.actualQty"), mode: "decimal", value: card.terms.quantity }]} />
          : null}
        {buyer && s === "DELIVERED" ? step(t("deals.acceptDelivery"), "accept") : null}
        {seller && s === "ACCEPTED" ? <ActionForm action={confirmPayment.bind(null, dealId)} submit={t("deals.payment")} /> : null}
        {s === "PAYMENT_CONFIRMED" ? step(t("deals.complete"), "complete") : null}
        {["AGREED", "PICKUP_CONFIRMED", "INSPECTION_PENDING"].includes(s)
          ? <ActionForm action={cancelDeal.bind(null, dealId)} submit={t("deals.cancel")} variant="danger" fields={[{ name: "reason", label: t("common.reason"), required: true }]} />
          : null}
      </div>

      {d.pendingAmendment ? (
        <Section title={t("deals.respondAmend")}>
          <Kv obj={{ proposedBy: d.pendingAmendment.proposedBy, ...d.pendingAmendment.terms }} />
          {d.pendingAmendment.proposedBy !== me.userId ? (
            <div className="forms">
              <ActionForm action={respondAmendment.bind(null, dealId, true)} submit={t("common.yes")} />
              <ActionForm action={respondAmendment.bind(null, dealId, false)} submit={t("common.no")} variant="danger" />
            </div>
          ) : null}
        </Section>
      ) : !["COMPLETED", "CANCELLED", "DISPUTED"].includes(s) ? (
        <Section title={t("deals.amend")}>
          <details>
            <summary>{t("deals.amend")}</summary>
            <ActionForm action={proposeAmendment.bind(null, dealId)} submit={t("deals.amend")} fields={[
              { name: "qty", label: t("sell.quantity"), mode: "decimal", value: card.terms.quantity },
              { name: "price", label: t("market.unitPrice"), type: "number", value: rupees(card.terms.unitPricePaise) },
            ]} />
          </details>
        </Section>
      ) : null}

      {partners.items.length ? (
        <Section title={t("deals.inspection")}>
          <ActionForm action={requestInspection.bind(null, dealId)} submit={t("deals.inspection")} fields={[
            { name: "partnerId", label: t("deals.partner"), type: "select", options: partners.items.map((p) => opt(p.partnerId, p.name ?? p.partnerId)) },
            { name: "at", label: t("deals.scheduled"), type: "datetime-local", required: true },
            { name: "loc", label: t("deals.location"), required: true },
          ]} />
        </Section>
      ) : null}
      {inspections.items.map((i) => (
        <Section key={i.inspectionId} title={`${t("deals.inspection")}: ${i.status}`}>
          {i.result ? <Kv obj={{ [t("partner.outcome")]: i.result.outcome, ...i.result.measurements, [t("partner.note")]: i.result.note }} /> : null}
          {buyer && i.status === "COMPLETED" ? (
            <div className="forms">
              <ActionForm action={decideInspection.bind(null, i.inspectionId, true)} submit={t("offers.accept")} />
              <ActionForm action={decideInspection.bind(null, i.inspectionId, false)} submit={t("offers.reject")} variant="danger" />
            </div>
          ) : null}
        </Section>
      ))}

      {!["COMPLETED", "CANCELLED"].includes(s) ? (
        <Section title={t("deals.transport")}>
          {quotes ? <>
            <h3>{t("deals.quotes")}</h3>
            {quotes.items.length ? quotes.items.map((q) => (
              <div className="row" key={q.quoteId}>
                <span>{`${money(locale, q.pricePaise)} · ${q.vehicleType} · ${when(locale, q.etaFrom)}`}</span>
                <ActionForm action={bookQuote.bind(null, q.quoteId)} submit={t("deals.book")} />
              </div>
            )) : <p className="hint">{t("deals.noQuotes")}</p>}
          </> : null}
          <details>
            <summary>{t("deals.transport")}</summary>
            <ActionForm action={requestTransport.bind(null, dealId)} submit={t("deals.transport")} fields={[
              { name: "dest", label: t("deals.destination"), type: "select", options: names.marketOptions() },
              { name: "kg", label: t("deals.weight"), type: "number", required: true },
              { name: "from", label: t("deals.window"), type: "datetime-local", required: true },
              { name: "to", label: t("deals.to"), type: "datetime-local", required: true },
            ]} />
          </details>
        </Section>
      ) : null}

      {["DELIVERED", "ACCEPTED", "PAYMENT_CONFIRMED", "AGREED", "PICKUP_CONFIRMED"].includes(s) && !d.disputeId ? (
        <Section title={t("deals.dispute")}>
          <details>
            <summary>{t("deals.dispute")}</summary>
            <ActionForm action={openDispute.bind(null, dealId)} submit={t("deals.dispute")} variant="danger" fields={[
              { name: "reason", label: t("deals.disputeReason"), type: "select", options: DISPUTE_REASONS.map((x) => opt(x)) },
              { name: "qty", label: t("sell.quantity"), mode: "decimal" },
              { name: "amount", label: t("deals.amount"), type: "number" },
            ]} />
          </details>
        </Section>
      ) : null}
      {dispute ? (
        <Section title={`${t("deals.dispute")}: ${dispute.status}`}>
          <Kv obj={{ [t("deals.disputeReason")]: dispute.reason, [t("offers.expires")]: when(locale, dispute.responseDueAt), ...(dispute.resolution ? { [t("ops.outcome")]: dispute.resolution.outcome, [t("common.reason")]: dispute.resolution.reason } : {}) }} />
          {dispute.respondent === me.userId && !dispute.response
            ? <ActionForm action={respondDispute.bind(null, dispute.disputeId)} submit={t("common.submit")} fields={[{ name: "text", label: t("deals.evidence"), type: "textarea", required: true }]} />
            : null}
        </Section>
      ) : null}

      <Section title={t("deals.evidence")}>
        <ActionForm action={addEvidence.bind(null, dealId)} submit={t("common.save")} fields={[{ name: "note", label: t("deals.evidence"), required: true }]} />
      </Section>
      <Section title={t("deals.timeline")}>
        {d.events.length ? <ol className="timeline">{d.events.map((e) => <li key={e.seq}>{`${when(locale, e.at)} — ${e.type}`}</li>)}</ol> : <Empty t={t} />}
      </Section>
    </>
  );
}
