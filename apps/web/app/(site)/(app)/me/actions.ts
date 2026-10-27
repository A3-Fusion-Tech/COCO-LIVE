"use server";
import { cookies } from "next/headers";
import { fields, type ActionState } from "../../../../lib/forms.ts";
import { LANG_COOKIE, LANG_COOKIE_MAX_AGE, isLocale } from "../../../../lib/i18n/index.ts";
import { perform } from "../../../_lib/actions.ts";
import { getT } from "../../../_lib/server.ts";

/** Saves the profile; the chosen language also becomes the UI language on this device. */
export async function updateProfile(_: ActionState, form: FormData): Promise<ActionState> {
  const f = fields(form);
  const locale = f.str("locale");
  const result = await perform(form, async (api) => {
    await api.patch("/v1/me", { displayName: f.str("displayName"), actingAs: f.str("actingAs"), locale });
    return (await getT())("me.saved");
  });
  if (result.status === "ok" && isLocale(locale)) (await cookies()).set(LANG_COOKIE, locale, { path: "/", sameSite: "lax", maxAge: LANG_COOKIE_MAX_AGE });
  return result;
}

export async function submitClaim(_: ActionState, form: FormData): Promise<ActionState> {
  const f = fields(form);
  return perform(form, async (api) => {
    const scope: Record<string, string> = {};
    if (f.str("marketId")) scope.marketId = f.str("marketId");
    if (f.str("productId")) scope.productId = f.str("productId");
    await api.post("/v1/claims", { type: f.str("type"), scope, evidence: [f.str("evidence")] });
    return (await getT())("me.claimSubmitted");
  });
}

export async function createOrganization(_: ActionState, form: FormData): Promise<ActionState> {
  const f = fields(form);
  return perform(form, async (api) => { await api.post("/v1/organizations", { name: f.str("name"), kind: f.str("kind") }); });
}
