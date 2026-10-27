"use server";
import { enc } from "../../../../lib/api/client.ts";
import type { Settlement } from "../../../../lib/api/types.ts";
import { csv, localIso, money, toPaise } from "../../../../lib/format.ts";
import { fields, type ActionState } from "../../../../lib/forms.ts";
import { perform } from "../../../_lib/actions.ts";
import { getLocale, getT } from "../../../_lib/server.ts";

export async function addMemberLot(orgId: string, _: ActionState, form: FormData): Promise<ActionState> {
  const f = fields(form);
  return perform(form, async (api) => {
    await api.post(`/v1/organizations/${enc(orgId)}/member-lots`, {
      memberName: f.str("memberName"), productId: f.str("productId"), gradeGroup: f.str("gradeGroup"), unit: f.str("unit"), quantity: f.str("quantity"),
      originMarketId: f.str("origin"), quality: { husk: f.str("husk") },
    });
  });
}

export async function reviewMemberLot(memberLotId: string, approve: boolean): Promise<ActionState> {
  return perform(null, async (api) => { await api.post(`/v1/member-lots/${enc(memberLotId)}/review`, { approve: approve === true }); });
}

/** Builds an aggregate sell lot from the approved member lots ticked in the form. */
export async function buildAggregate(orgId: string, _: ActionState, form: FormData): Promise<ActionState> {
  const f = fields(form);
  return perform(form, async (api) => {
    await api.post(`/v1/organizations/${enc(orgId)}/aggregates`, {
      memberLotIds: f.all("memberLotIds"), tolerancePercent: Number(f.str("tol")),
      availableFrom: localIso(f.str("from")), availableTo: localIso(f.str("to")), expiresAt: localIso(f.str("expires")),
      fulfilment: { mode: "PICKUP", costsIncluded: ["LOADING"], costsExcluded: [] }, priceExpectation: { inviteOffers: true },
    });
  });
}

/** Drafts the member settlement for an aggregate deal; deductions are typed as `TYPE:₹, …`. */
export async function draftSettlement(dealId: string, _: ActionState, form: FormData): Promise<ActionState> {
  const f = fields(form);
  return perform(form, async (api) => {
    const deductions = csv(f.str("ded")).map((x) => { const [type = "", amount = ""] = x.split(":"); return { type: type.trim(), amountPaise: toPaise(amount) }; });
    const st = await api.post<Settlement>(`/v1/deals/${enc(dealId)}/settlement`, { deductions });
    return `${(await getT())("deals.settlement")}: ${money(await getLocale(), st.netPaise)}`;
  });
}
