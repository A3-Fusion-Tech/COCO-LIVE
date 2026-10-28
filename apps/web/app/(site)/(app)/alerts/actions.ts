"use server";
import { enc } from "../../../../lib/api/client.ts";
import { toPaise } from "../../../../lib/format.ts";
import { fields, type ActionState } from "../../../../lib/forms.ts";
import { perform } from "../../../_lib/actions.ts";
import { getT } from "../../../_lib/server.ts";

export async function createAlert(_: ActionState, form: FormData): Promise<ActionState> {
  const f = fields(form);
  return perform(form, async (api) => {
    await api.post("/v1/alerts", {
      productId: f.str("productId"), marketId: f.str("marketId"), unit: f.str("unit"), stage: f.str("stage"),
      direction: f.str("direction"), thresholdPaise: toPaise(f.str("threshold")), channel: f.str("channel"), consent: f.bool("consent"),
    });
    return (await getT())("prices.alertSaved");
  });
}

export async function setAlertStatus(alertId: string, status: "ACTIVE" | "PAUSED" | "CANCELLED"): Promise<ActionState> {
  return perform(null, async (api) => { await api.patch(`/v1/alerts/${enc(alertId)}`, { status }); });
}
