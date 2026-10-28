import { t as domainT, type Locale } from "@livecoco/localization";
import { UI } from "./messages.ts";

export type { Locale };
export type Translate = (key: string) => string;

/** Tamil first: it is the default whenever the request does not say otherwise. */
export const DEFAULT_LOCALE: Locale = "ta";
/** Language preference cookie. Not sensitive, so readable by the page; set by `?lang=` (see `proxy.ts`). */
export const LANG_COOKIE = "lc_lang";
export const LANG_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export const isLocale = (v: unknown): v is Locale => v === "ta" || v === "en";
export const otherLocale = (l: Locale): Locale => (l === "ta" ? "en" : "ta");

/**
 * The request locale, so server components can render it: `?lang=` wins, then the `lc_lang` cookie, then the
 * first `Accept-Language` tag when it is Tamil or English, else Tamil.
 */
export function resolveLocale(input: { query?: string | null | undefined; cookie?: string | null | undefined; acceptLanguage?: string | null | undefined }): Locale {
  if (isLocale(input.query)) return input.query;
  if (isLocale(input.cookie)) return input.cookie;
  const first = (input.acceptLanguage ?? "").split(",")[0]?.trim().toLowerCase() ?? "";
  if (first.startsWith("en")) return "en";
  return DEFAULT_LOCALE;
}

/** UI strings from the web catalog, falling back to the shared domain catalog, then to English, then to the key. */
export function translator(locale: Locale): Translate {
  return (key) => UI[locale][key] ?? UI.en[key] ?? domainT(locale, key);
}

/** A translated status label, or the raw status when the catalog has none. */
export const statusLabel = (t: Translate, status: string) => {
  const label = t(`status.${status}`);
  return label === `status.${status}` ? status : label;
};

/** Keys present in one UI locale but not the other (tests keep both catalogs in step). */
export function missingUiKeys(): { locale: Locale; keys: string[] }[] {
  const en = Object.keys(UI.en);
  const ta = Object.keys(UI.ta);
  return [{ locale: "ta", keys: en.filter((k) => !(k in UI.ta)) }, { locale: "en", keys: ta.filter((k) => !(k in UI.en)) }];
}
