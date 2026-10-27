import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import type { ApiClient } from "../../lib/api/client.ts";
import { describeProblem, isApiError } from "../../lib/api/errors.ts";
import { fields, type ActionState } from "../../lib/forms.ts";
import { getApi, getT } from "./server.ts";

/** What an action body returns: a success message, a path to go to next, or nothing. */
export type Outcome = string | { redirect: string } | void;

/**
 * Runs a server action body against the API with the caller's session. API problems become an error state shown
 * next to the form (with the submitted values, so nothing typed is lost); a 401 sends the user to sign in.
 * On success the page's server components re-render with fresh data, or the user is redirected.
 * Server actions are POST-only and Next.js rejects them when `Origin` does not match the host, which together
 * with the SameSite=Strict session cookie is the CSRF protection for every mutation made from the UI.
 */
export async function perform(form: FormData | null, body: (api: ApiClient) => Promise<Outcome>): Promise<ActionState> {
  const [api, t] = await Promise.all([getApi(), getT()]);
  let outcome: Outcome;
  try {
    outcome = await body(api);
  } catch (e) {
    if (!isApiError(e)) throw e;
    if (e.status === 401) redirect("/login");
    return { status: "error", message: describeProblem(e.problem, t("err.generic")), at: Date.now(), ...(form ? { values: fields(form).values() } : {}) };
  }
  if (outcome && typeof outcome === "object") redirect(outcome.redirect);
  refresh();
  return { status: "ok", ...(outcome ? { message: outcome } : {}), at: Date.now() };
}
