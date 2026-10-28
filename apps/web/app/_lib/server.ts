import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { ApiClient } from "../../lib/api/client.ts";
import { isApiError } from "../../lib/api/errors.ts";
import type { Catalog, Me } from "../../lib/api/types.ts";
import { clientIp, gatewayConfig } from "../../lib/gateway/config.ts";
import { SESSION_COOKIE } from "../../lib/gateway/session.ts";
import { LANG_COOKIE, isLocale, resolveLocale, translator, type Locale } from "../../lib/i18n/index.ts";

/** Request headers set by `proxy.ts` (it overwrites any client-sent value). */
export const LOCALE_HEADER = "x-lc-locale";
export const PATH_HEADER = "x-lc-path";

/** The request's UI locale, as resolved by `proxy.ts` (`?lang=`, then cookie, then `Accept-Language`). */
export const getLocale = cache(async (): Promise<Locale> => {
  const h = await headers();
  const fromProxy = h.get(LOCALE_HEADER);
  if (isLocale(fromProxy)) return fromProxy;
  return resolveLocale({ cookie: (await cookies()).get(LANG_COOKIE)?.value, acceptLanguage: h.get("accept-language") });
});

export const getT = cache(async () => translator(await getLocale()));

/** The API client for this request: session from the HttpOnly cookie, UI locale, trusted client address. */
export const getApi = cache(async (): Promise<ApiClient> => {
  const cfg = gatewayConfig();
  const [c, h, locale] = await Promise.all([cookies(), headers(), getLocale()]);
  return new ApiClient({ baseUrl: cfg.apiBaseUrl, token: c.get(SESSION_COOKIE)?.value, locale, clientIp: clientIp(h, cfg) });
});

/** An API client without the session, for public data that may be cached across users. */
export const publicApi = () => new ApiClient({ baseUrl: gatewayConfig().apiBaseUrl });

/** The catalog changes with deployments only; cached for an hour. */
export const getCatalog = cache((): Promise<Catalog> => publicApi().catalog({ revalidate: 3600 }));

/** The signed-in user, or `null` without a (valid) session. */
export const getMe = cache(async (): Promise<Me | null> => {
  const api = await getApi();
  if (!api.options.token) return null;
  try { return await api.me(); } catch (e) {
    if (isApiError(e) && e.status === 401) return null;
    throw e;
  }
});

export const loginHref = (next: string) => `/login?next=${encodeURIComponent(next)}`;

/** The signed-in user; otherwise redirects to the login page, which returns here afterwards. */
export async function requireMe(): Promise<Me> {
  const me = await getMe();
  if (!me) redirect(loginHref((await headers()).get(PATH_HEADER) ?? "/"));
  return me;
}

/** Awaits an API read; a 404 renders the nearest `not-found`, a 401 sends the user to sign in. */
export async function load<T>(p: Promise<T>): Promise<T> {
  try { return await p; } catch (e) {
    if (isApiError(e) && e.status === 404) notFound();
    if (isApiError(e) && e.status === 401) redirect(loginHref((await headers()).get(PATH_HEADER) ?? "/"));
    throw e;
  }
}

/** Display names from the catalog, in the UI language. */
export async function getNames() {
  const [catalog, locale] = await Promise.all([getCatalog(), getLocale()]);
  return {
    catalog,
    product: (id: string) => catalog.products.find((p) => p.productId === id)?.name[locale] ?? id,
    market: (id: string) => catalog.markets.find((m) => m.marketId === id)?.name[locale] ?? id,
    productOptions: () => catalog.products.map((p) => ({ value: p.productId, label: p.name[locale] })),
    marketOptions: () => catalog.markets.map((m) => ({ value: m.marketId, label: m.name[locale] })),
    unitOptions: (productId = "prod_mature_coconut") => (catalog.products.find((p) => p.productId === productId)?.units ?? ["NUT", "KG", "QUINTAL", "TONNE"]).map((u) => ({ value: u, label: u })),
  };
}
