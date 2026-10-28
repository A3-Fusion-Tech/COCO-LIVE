import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { ServiceWorker } from "../_components/chrome.tsx";
import { SiteHeader } from "../_components/SiteHeader.tsx";
import { getLocale, getMe, getT } from "../_lib/server.ts";
import "../globals.css";

export const metadata: Metadata = { title: "LiveCoco", manifest: "/manifest.webmanifest", icons: { icon: [{ url: "/icon.svg", type: "image/svg+xml" }] } };
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#2e7d32" };

/**
 * Root layout of the web app (market, sign-in and the signed-in workspace). Rendered per request: it reads the
 * language and session cookies, and each response carries the CSP nonce from `proxy.ts`.
 */
export default async function SiteLayout({ children }: { children: ReactNode }) {
  const [locale, t] = await Promise.all([getLocale(), getT()]);
  // The header degrades to the signed-out navigation if the API is unreachable; the page shows the error.
  const me = await getMe().catch(() => null);
  return (
    <html lang={locale}>
      <body>
        <a className="skip" href="#main">{t("common.skip")}</a>
        <SiteHeader t={t} locale={locale} me={me} />
        <main id="main" tabIndex={-1}>{children}</main>
        <ServiceWorker />
      </body>
    </html>
  );
}
