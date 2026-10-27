"use server";
import { enc } from "../../../../lib/api/client.ts";
import { invalidInput } from "../../../../lib/api/errors.ts";
import { fields, type ActionState } from "../../../../lib/forms.ts";
import { perform } from "../../../_lib/actions.ts";
import { getT } from "../../../_lib/server.ts";

export async function requestStepUp(): Promise<ActionState> {
  return perform(null, async (api) => { await api.post("/v1/auth/step-up/request"); return (await getT())("login.sent"); });
}

export async function stepUp(_: ActionState, form: FormData): Promise<ActionState> {
  return perform(form, async (api) => { await api.post("/v1/auth/step-up", { code: fields(form).str("code") }); return (await getT())("ops.stepupOk"); });
}

/**
 * Decides one review-queue item. The item (its queue and subject) is looked up on the server, so the form only
 * carries the operator's decision and reason; every decision requires a reason.
 */
export async function decideQueueItem(queueItemId: string, _: ActionState, form: FormData): Promise<ActionState> {
  const f = fields(form);
  return perform(form, async (api) => {
    const it = (await api.opsQueues()).items.find((x) => x.queueItemId === queueItemId);
    if (!it) throw invalidInput("This item is no longer in the queue.");
    const reason = f.str("reason");
    const subject = enc(it.subject);
    switch (it.queue) {
      case "PRICE_REVIEW": await api.post(`/v1/ops/observations/${subject}/review`, { decision: f.str("decision"), reason }); break;
      case "MAPPING": await api.post(`/v1/ops/mapping/${enc(it.queueItemId)}/resolve`, { mapping: { productId: f.str("productId"), marketId: f.str("marketId"), unit: f.str("unit") }, reason }); break;
      case "VERIFICATION":
        if (it.subject.startsWith("org_")) await api.post(`/v1/ops/partners/${subject}/decision`, { decision: f.str("decision"), reason });
        else await api.post(`/v1/ops/claims/${subject}/decision`, { decision: f.str("decision"), reasonCode: reason });
        break;
      case "LISTING_REVIEW": await api.post(`/v1/ops/listings/${subject}/review`, { decision: f.str("decision"), reason }); break;
      case "DISPUTE": await api.post(`/v1/ops/disputes/${subject}/resolve`, { outcome: f.str("decision"), reason }); break;
      case "RISK": await api.post(`/v1/ops/users/${subject}/suspend`, { reason }); break;
    }
  });
}
