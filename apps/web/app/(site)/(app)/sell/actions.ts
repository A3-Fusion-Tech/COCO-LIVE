"use server";
import { enc } from "../../../../lib/api/client.ts";
import { describeProblem, isApiError } from "../../../../lib/api/errors.ts";
import type { UploadIntent } from "../../../../lib/api/types.ts";
import { csv, localIso, toPaise } from "../../../../lib/format.ts";
import { fields, type ActionState } from "../../../../lib/forms.ts";
import { perform } from "../../../_lib/actions.ts";
import { getApi, getT } from "../../../_lib/server.ts";
import { QUALITY_FIELDS } from "./quality.ts";

export async function createLot(_: ActionState, form: FormData): Promise<ActionState> {
  const f = fields(form);
  const productId = f.str("productId");
  return perform(form, async (api) => {
    const price = f.str("price");
    const onBehalf = f.str("onBehalf");
    await api.post("/v1/sell-lots", {
      productId,
      gradeAttributes: Object.fromEntries((QUALITY_FIELDS[productId] ?? []).map((q) => [q.name, f.str(q.name)])),
      gradeGroup: f.str("gradeGroup"), unit: f.str("unit"), quantityTotal: f.str("quantity"), partialFulfilmentAllowed: f.bool("partial"),
      originMarketId: f.str("origin"), availableFrom: localIso(f.str("from")), availableTo: localIso(f.str("to")), expiresAt: localIso(f.str("expires")),
      fulfilment: { mode: f.str("mode"), costsIncluded: csv(f.str("costsIn")), costsExcluded: csv(f.str("costsEx")) },
      priceExpectation: price ? { unitPricePaise: toPaise(price) } : { inviteOffers: true },
      ...(onBehalf ? { listedOnBehalfOf: onBehalf } : {}),
    });
  });
}

export async function activateLot(lotId: string): Promise<ActionState> {
  return perform(null, async (api) => { await api.post(`/v1/sell-lots/${enc(lotId)}/activate`); });
}

export async function withdrawLot(lotId: string): Promise<ActionState> {
  return perform(null, async (api) => { await api.post(`/v1/sell-lots/${enc(lotId)}/withdraw`); });
}

/**
 * Step 1 of a photo upload: a short-lived signed URL from the API. The browser then PUTs the file to it through
 * the same-origin `/v1` proxy (signed uploads need no session or CSRF header), so the file never passes through
 * a server action.
 */
export async function createPhotoUpload(lotId: string, contentType: string, sizeBytes: number): Promise<{ ok: true; path: string } | { ok: false; message: string }> {
  try {
    const intent = await (await getApi()).post<UploadIntent>("/v1/uploads/intents", { purpose: "LOT_PHOTO", contentType, sizeBytes, refId: lotId });
    const u = new URL(intent.uploadUrl, "http://web.invalid");
    return { ok: true, path: u.pathname + u.search };
  } catch (e) {
    if (!isApiError(e)) throw e;
    return { ok: false, message: describeProblem(e.problem, (await getT())("err.generic")) };
  }
}
