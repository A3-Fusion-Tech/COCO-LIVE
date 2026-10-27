"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";

export interface NavLink { href: string; label: string }

const isCurrent = (pathname: string, href: string) => (href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`));

/** Main navigation; marks the current section. */
export function NavLinks({ links }: { links: NavLink[] }) {
  const pathname = usePathname();
  return (
    <nav id="nav" aria-label="Main">
      {links.map((l) => l.href === "/"
        // The price board has its own root layout, so it is a full page load either way.
        ? <a key={l.href} href="/" aria-current={isCurrent(pathname, l.href) ? "page" : undefined}>{l.label}</a>
        : <Link key={l.href} href={l.href} aria-current={isCurrent(pathname, l.href) ? "page" : undefined}>{l.label}</Link>)}
    </nav>
  );
}

/**
 * Tamil/English switch: reloads the current page with `?lang=`, which `proxy.ts` stores in the `lc_lang`
 * cookie so server components render the chosen language from then on.
 */
export function LangToggle({ to, label }: { to: "ta" | "en"; label: string }) {
  const pathname = usePathname();
  return <a id="lang" className="btn secondary" href={`${pathname}?lang=${to}`} hrefLang={to} lang={to}>{label}</a>;
}

/** Registers the offline service worker (`public/sw.js`). */
export function ServiceWorker() {
  useEffect(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);
  return null;
}
