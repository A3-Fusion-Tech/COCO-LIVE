import type { Me } from "../../lib/api/types.ts";
import { otherLocale, type Locale, type Translate } from "../../lib/i18n/index.ts";
import { LangToggle, NavLinks, type NavLink } from "./chrome.tsx";

/** Navigation by session: public pages, signed-in workflows, the operations console for operators. */
export function navLinks(t: Translate, me: Me | null): NavLink[] {
  const links: NavLink[] = [{ href: "/", label: t("nav.prices") }, { href: "/market", label: t("nav.market") }];
  if (me) {
    for (const [href, key] of [["/sell", "nav.sell"], ["/buy", "nav.buy"], ["/deals", "nav.deals"], ["/alerts", "nav.alerts"], ["/org", "nav.org"], ["/partner", "nav.partner"], ["/me", "nav.me"]] as const) links.push({ href, label: t(key) });
    if (me.capabilities.some((c) => c.startsWith("ops."))) links.push({ href: "/ops", label: t("nav.ops") });
  } else {
    links.push({ href: "/login", label: t("nav.login") });
  }
  return links;
}

export function SiteHeader({ t, locale, me }: { t: Translate; locale: Locale; me: Me | null }) {
  const other = otherLocale(locale);
  return (
    <header className="top">
      <a className="brand" href="/">LiveCoco</a>
      <NavLinks links={navLinks(t, me)} />
      <LangToggle to={other} label={other === "ta" ? "தமிழ்" : "English"} />
    </header>
  );
}
