"use server";
import { enc } from "../../../../lib/api/client.ts";
import { localIso, toPaise } from "../../../../lib/format.ts";
import { fields, type ActionState } from "../../../../lib/forms.ts";
import { perform } from "../../../_lib/actions.ts";

export async function createRequirement(_: ActionState, form: FormData): Promise<ActionState> {
  const f = fields(form);
  return perform(form, async (api) => {
    const target = f.str("target");
    const maxPrice = f.str("maxPrice");
    const body = {
      productId: f.str("productId"), gradeGroup: f.str("gradeGroup"), unit: f.str("unit"), targetQuantity: target, minQuantity: f.str("min") || target,
      partialAllowed: f.bool("partial"), destinationMarketId: f.str("dest"), maxRadiusKm: Number(f.str("radius")),
      requiredFrom: localIso(f.str("from")), requiredBy: localIso(f.str("by")), expiresAt: localIso(f.str("expires")),
      ...(maxPrice ? { maxUnitPricePaise: toPaise(maxPrice) } : {}),
    };
    const repeat = f.str("repeat");
    if (repeat) await api.post("/v1/buy-requirements/recurring", { ...body, cadence: repeat, occurrences: Number(f.str("times")) });
    else await api.post("/v1/buy-requirements", body);
  });
}

export async function closeRequirement(requirementId: string): Promise<ActionState> {
  return perform(null, async (api) => { await api.post(`/v1/buy-requirements/${enc(requirementId)}/close`); });
}
