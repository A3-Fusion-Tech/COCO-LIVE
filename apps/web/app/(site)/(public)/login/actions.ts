"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { describeProblem, isApiError } from "../../../../lib/api/errors.ts";
import type { VerifiedSession } from "../../../../lib/api/types.ts";
import { fields, type ActionState } from "../../../../lib/forms.ts";
import { gatewayConfig } from "../../../../lib/gateway/config.ts";
import { SESSION_COOKIE, safeNextPath, sessionCookieOptions } from "../../../../lib/gateway/session.ts";
import { getApi, getT } from "../../../_lib/server.ts";

const fail = async (e: unknown, form: FormData): Promise<ActionState> => {
  if (!isApiError(e)) throw e;
  return { status: "error", message: describeProblem(e.problem, (await getT())("err.generic")), at: Date.now(), values: fields(form).values() };
};

/** Step 1: ask the API to send a one-time code. The API rate-limits per phone and per client address. */
export async function requestOtp(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    await (await getApi()).post("/v1/auth/otp/request", { phone: fields(form).str("phone") });
  } catch (e) { return fail(e, form); }
  return { status: "ok", message: (await getT())("login.sent"), at: Date.now() };
}

/**
 * Step 2: verify the code upstream and keep the session token only in the HttpOnly, SameSite=Strict cookie.
 * The token is never part of a response body or visible to page JavaScript.
 */
export async function verifyOtp(_: ActionState, form: FormData): Promise<ActionState> {
  const f = fields(form);
  let session: VerifiedSession;
  try {
    session = await (await getApi()).post<VerifiedSession>("/v1/auth/otp/verify", { phone: f.str("phone"), code: f.str("code") });
  } catch (e) { return fail(e, form); }
  (await cookies()).set(SESSION_COOKIE, session.token, sessionCookieOptions(gatewayConfig().secureCookies));
  redirect(safeNextPath(f.str("next"), "/market"));
}

/** Clears the session cookie. */
export async function logout(): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, "", sessionCookieOptions(gatewayConfig().secureCookies, 0));
  redirect("/");
}
