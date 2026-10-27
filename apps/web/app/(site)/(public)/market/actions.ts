"use server";
import { invalidInput } from "../../../../lib/api/errors.ts";
import { hoursFromNow, toPaise } from "../../../../lib/format.ts";
import { fields, type ActionState } from "../../../../lib/forms.ts";
import { perform } from "../../../_lib/actions.ts";
import { getNames } from "../../../_lib/server.ts";
import { findMarketLot } from "./lots.ts";

/** Makes an offer on a market lot. Lot terms are re-read on the server rather than taken from the form. */
export async function makeOffer(lotId: string, _: ActionState, form: FormData): Promise<ActionState> {
  const f = fields(form);
  return perform(form, async (api) => {
    const [lot, names] = await Promise.all([findMarketLot(api, lotId), getNames()]);
    if (!lot) throw invalidInput("This lot is no longer available.");
    await api.post("/v1/offers", {
      sellLotId: lot.sellLotId,
      expiresAt: hoursFromNow(Number(f.str("hours") || 24)),
      terms: {
        quantity: f.str("qty"), unit: lot.unit, unitPricePaise: toPaise(f.str("price")), gradeGroup: lot.gradeGroup,
        fulfilmentMode: lot.fulfilment.mode, costsIncluded: lot.fulfilment.costsIncluded, costsExcluded: lot.fulfilment.costsExcluded,
        weighmentMethod: f.str("weigh"), weighmentLocation: names.market(lot.originMarketId), paymentMethod: f.str("payment"), paymentDue: f.str("due"),
        fulfilmentFrom: lot.availableFrom, fulfilmentBy: lot.availableTo, acceptanceWindowHours: 24, inspectionTerms: "Buyer may inspect at loading",
      },
    });
    return { redirect: "/deals" };
  });
}
