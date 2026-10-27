"use server";
import { enc } from "../../../../lib/api/client.ts";
import { csv, hoursFromNow, localIso, toPaise } from "../../../../lib/format.ts";
import { fields, type ActionState } from "../../../../lib/forms.ts";
import { perform } from "../../../_lib/actions.ts";

export async function applyAsPartner(_: ActionState, form: FormData): Promise<ActionState> {
  const f = fields(form);
  return perform(form, async (api) => { await api.post("/v1/partners", { organizationId: f.str("organizationId"), serviceMarketIds: csv(f.str("markets")) }); });
}

export async function acceptInspection(inspectionId: string): Promise<ActionState> {
  return perform(null, async (api) => { await api.post(`/v1/inspections/${enc(inspectionId)}/accept`); });
}

/** Measurements are typed as `name:value, …`. */
export async function submitInspectionResult(inspectionId: string, _: ActionState, form: FormData): Promise<ActionState> {
  const f = fields(form);
  return perform(form, async (api) => {
    const measurements = Object.fromEntries(csv(f.str("m")).map((x) => { const [k = "", v = ""] = x.split(":"); return [k.trim(), Number(v)]; }));
    await api.post(`/v1/inspections/${enc(inspectionId)}/result`, { outcome: f.str("outcome"), measurements, note: f.str("note") });
  });
}

export async function quoteTransport(requestId: string, _: ActionState, form: FormData): Promise<ActionState> {
  const f = fields(form);
  return perform(form, async (api) => {
    const eta = localIso(f.str("eta"));
    await api.post(`/v1/transport-requests/${enc(requestId)}/quotes`, { pricePaise: toPaise(f.str("price")), vehicleType: f.str("vehicle"), etaFrom: eta, etaTo: eta, validUntil: hoursFromNow(24) });
  });
}

const TRANSPORT_STATUSES = ["PICKED_UP", "IN_TRANSIT", "DELIVERED"] as const;
export async function updateTransportStatus(requestId: string, status: (typeof TRANSPORT_STATUSES)[number]): Promise<ActionState> {
  if (!TRANSPORT_STATUSES.includes(status)) throw new Error("Unknown transport status");
  return perform(null, async (api) => { await api.post(`/v1/transport-requests/${enc(requestId)}/status`, { status }); });
}
