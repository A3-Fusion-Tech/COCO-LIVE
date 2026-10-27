import type { ReactNode } from "react";
import { requireMe } from "../../_lib/server.ts";

/**
 * Everything under this group needs a session. `proxy.ts` already redirects requests without the session cookie
 * to `/login`; this check also catches expired or revoked sessions (the API answers 401). Pages call
 * `requireMe()` themselves too (deduplicated per request), because layouts are not re-rendered on client navigation.
 */
export default async function SignedInLayout({ children }: { children: ReactNode }) {
  await requireMe();
  return children;
}
