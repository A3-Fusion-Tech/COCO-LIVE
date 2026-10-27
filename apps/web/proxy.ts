import { NextResponse, type NextRequest } from "next/server.js";
import { SESSION_COOKIE } from "./lib/gateway/session.ts";
import { LANG_COOKIE, LANG_COOKIE_MAX_AGE, isLocale, resolveLocale } from "./lib/i18n/index.ts";
import { appCsp, boardCsp, newNonce } from "./lib/security/csp.ts";

/** Sections that need a session (the `(app)` route group). */
const SIGNED_IN = ["/sell", "/buy", "/deals", "/alerts", "/org", "/partner", "/me", "/ops"];
/** All per-request rendered sections (the `(site)` route group). */
const SITE = ["/market", "/login", "/prices", ...SIGNED_IN];
const within = (sections: string[], p: string) => sections.some((s) => p === s || p.startsWith(`${s}/`));

/**
 * Runs before every page:
 * - `/` redirects to the price board in the visitor's language (`/ta` or `/en`). Those URLs are statically
 *   regenerated and identical for everyone, so shared caches can keep them without varying on cookies;
 * - `?lang=` is remembered in the `lc_lang` cookie, and the resolved locale is handed to server components;
 * - requests for signed-in sections without a session cookie go straight to `/login?next=…` (the `(app)` layout
 *   still validates the session itself);
 * - app pages get a CSP with a fresh nonce; the shared, static board (and static 404s) a CSP without one.
 */
export function proxy(req: NextRequest) {
  const { pathname, searchParams, search } = req.nextUrl;
  const dev = process.env.NODE_ENV === "development";
  const query = searchParams.get("lang");
  const locale = resolveLocale({ query, cookie: req.cookies.get(LANG_COOKIE)?.value, acceptLanguage: req.headers.get("accept-language") });
  const remember = (res: NextResponse) => {
    if (isLocale(query)) res.cookies.set(LANG_COOKIE, query, { path: "/", sameSite: "lax", maxAge: LANG_COOKIE_MAX_AGE });
    return res;
  };

  if (pathname === "/") return remember(NextResponse.redirect(new URL(`/${locale}`, req.url)));

  if (!within(SITE, pathname)) {
    const res = NextResponse.next();
    res.headers.set("content-security-policy", boardCsp(dev));
    return remember(res);
  }

  if (within(SIGNED_IN, pathname) && !req.cookies.has(SESSION_COOKIE)) {
    const login = new URL("/login", req.url);
    login.searchParams.set("next", pathname + search);
    return remember(NextResponse.redirect(login));
  }

  const csp = appCsp(newNonce(), dev);
  const headers = new Headers(req.headers);
  headers.set("content-security-policy", csp);
  headers.set("x-lc-locale", locale);
  headers.set("x-lc-path", pathname + search);
  const res = NextResponse.next({ request: { headers } });
  res.headers.set("content-security-policy", csp);
  return remember(res);
}

export const config = {
  // Pages only: not the API proxy, health check, static assets, the service worker, icons or the manifest.
  matcher: [{ source: "/((?!v1/|healthz|_next/static|_next/image|sw\\.js|icon\\.svg|manifest\\.webmanifest|favicon\\.ico).*)" }],
};
