"use server";
import { enc, type ApiClient } from "../../../../lib/api/client.ts";
import { invalidInput } from "../../../../lib/api/errors.ts";
import type { Deal, DealCard, TransportRequest } from "../../../../lib/api/types.ts";
import { hoursFromNow, localIso, toPaise } from "../../../../lib/format.ts";
import { fields, type ActionState } from "../../../../lib/forms.ts";
import { perform } from "../../../_lib/actions.ts";
import { getT } from "../../../_lib/server.ts";

// ---- offers --------------------------------------------------------------------------------
export async function acceptOffer(offerId: string): Promise<ActionState> {
  return perform(null, async (api) => {
    // A fixed key: a double submit replays the same acceptance instead of failing.
    const deal = await api.post<Deal>(`/v1/offers/${enc(offerId)}/accept`, {}, { idempotencyKey: `accept-${offerId}` });
    return { redirect: `/deals/${encodeURIComponent(deal.dealId)}` };
  });
}

export async function rejectOffer(offerId: string): Promise<ActionState> {
  return perform(null, async (api) => { await api.post(`/v1/offers/${enc(offerId)}/reject`); });
}

export async function withdrawOffer(offerId: string): Promise<ActionState> {
  return perform(null, async (api) => { await api.post(`/v1/offers/${enc(offerId)}/withdraw`); });
}

/** Counters with a new unit price; the other terms are the offer's current ones, read on the server. */
export async function counterOffer(offerId: string, _: ActionState, form: FormData): Promise<ActionState> {
  const f = fields(form);
  return perform(form, async (api) => {
    const offer = (await api.offers()).items.find((o) => o.offerId === offerId);
    if (!offer) throw invalidInput("Offer not found");
    await api.post(`/v1/offers/${enc(offerId)}/counter`, { terms: { ...offer.terms, unitPricePaise: toPaise(f.str("price")) }, expiresAt: hoursFromNow(Number(f.str("hours") || 24)) });
    return (await getT())("common.done");
  });
}

// ---- deal lifecycle ----------------------------------------------------------------------------
const currentCard = async (api: ApiClient, dealId: string): Promise<DealCard> => {
  const card = (await api.deal(dealId)).cards.at(-1);
  if (!card) throw invalidInput("Deal has no card");
  return card;
};

const STEPS = ["pickup", "accept", "complete"] as const;
/** Steps without a body: confirm pickup, accept delivery, complete. */
export async function dealStep(dealId: string, step: (typeof STEPS)[number]): Promise<ActionState> {
  if (!STEPS.includes(step)) throw new Error("Unknown deal step");
  return perform(null, async (api) => { await api.post(`/v1/deals/${enc(dealId)}/${step}`); });
}

export async function confirmDelivery(dealId: string, _: ActionState, form: FormData): Promise<ActionState> {
  return perform(form, async (api) => { await api.post(`/v1/deals/${enc(dealId)}/delivery`, { actualQuantity: fields(form).str("actualQuantity") }); });
}

export async function confirmPayment(dealId: string): Promise<ActionState> {
  return perform(null, async (api) => { await api.post(`/v1/deals/${enc(dealId)}/payment`, { method: (await currentCard(api, dealId)).terms.paymentMethod }); });
}

export async function cancelDeal(dealId: string, _: ActionState, form: FormData): Promise<ActionState> {
  return perform(form, async (api) => { await api.post(`/v1/deals/${enc(dealId)}/cancel`, { reason: fields(form).str("reason") }); });
}

export async function proposeAmendment(dealId: string, _: ActionState, form: FormData): Promise<ActionState> {
  const f = fields(form);
  return perform(form, async (api) => {
    const card = await currentCard(api, dealId);
    await api.post(`/v1/deals/${enc(dealId)}/amendments`, { terms: { ...card.terms, quantity: f.str("qty"), unitPricePaise: toPaise(f.str("price")) } });
  });
}

export async function respondAmendment(dealId: string, accept: boolean): Promise<ActionState> {
  return perform(null, async (api) => { await api.post(`/v1/deals/${enc(dealId)}/amendments/respond`, { accept: accept === true }); });
}

export async function addEvidence(dealId: string, _: ActionState, form: FormData): Promise<ActionState> {
  return perform(form, async (api) => {
    await api.post(`/v1/deals/${enc(dealId)}/evidence`, { kind: "NOTE", note: fields(form).str("note") });
    return (await getT())("me.saved");
  });
}

// ---- inspection and transport -----------------------------------------------------------------
export async function requestInspection(dealId: string, _: ActionState, form: FormData): Promise<ActionState> {
  const f = fields(form);
  return perform(form, async (api) => { await api.post(`/v1/deals/${enc(dealId)}/inspections`, { partnerId: f.str("partnerId"), scheduledAt: localIso(f.str("at")), location: f.str("loc") }); });
}

export async function decideInspection(inspectionId: string, accept: boolean): Promise<ActionState> {
  return perform(null, async (api) => { await api.post(`/v1/inspections/${enc(inspectionId)}/decision`, { accept: accept === true }); });
}

/** Opens a transport request and shows its quotes on the deal page (`?transport=`). */
export async function requestTransport(dealId: string, _: ActionState, form: FormData): Promise<ActionState> {
  const f = fields(form);
  return perform(form, async (api) => {
    const r = await api.post<TransportRequest>(`/v1/deals/${enc(dealId)}/transport-requests`, { destinationMarketId: f.str("dest"), weightKg: Number(f.str("kg")), windowFrom: localIso(f.str("from")), windowTo: localIso(f.str("to")) });
    return { redirect: `/deals/${encodeURIComponent(dealId)}?transport=${encodeURIComponent(r.requestId)}` };
  });
}

export async function bookQuote(quoteId: string): Promise<ActionState> {
  return perform(null, async (api) => { await api.post(`/v1/transport-quotes/${enc(quoteId)}/book`, { vehicle: { registration: "TBD", driverPhone: "TBD" } }); });
}

// ---- disputes ----------------------------------------------------------------------------------
export async function openDispute(dealId: string, _: ActionState, form: FormData): Promise<ActionState> {
  const f = fields(form);
  return perform(form, async (api) => {
    const qty = f.str("qty");
    const amount = f.str("amount");
    await api.post(`/v1/deals/${enc(dealId)}/disputes`, { reason: f.str("reason"), ...(qty ? { claimedQuantity: qty } : {}), ...(amount ? { claimedAmountPaise: toPaise(amount) } : {}) });
  });
}

export async function respondDispute(disputeId: string, _: ActionState, form: FormData): Promise<ActionState> {
  return perform(form, async (api) => { await api.post(`/v1/disputes/${enc(disputeId)}/response`, { text: fields(form).str("text") }); });
}
