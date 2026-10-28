import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { DEFAULT_LOCALE, isLocale, translator } from "../../../lib/i18n/index.ts";
import { ServiceWorker } from "../../_components/chrome.tsx";
import "../../globals.css";

interface Props { children: ReactNode; params: Promise<{ lang: string }> }

/**
 * Root layout of the public price board (`/ta`, `/en`; `/` is rewritten to one of them by `proxy.ts`). The
 * language comes from the URL, not from cookies, so the page can be regenerated statically and shared by everyone.
 * Any other single-segment path also lands here and the page answers 404.
 */
export async function generateMetadata({ params }: Omit<Props, "children">): Promise<Metadata> {
  const { lang } = await params;
  const t = translator(isLocale(lang) ? lang : DEFAULT_LOCALE);
  return { title: `${t("price.title")} · LiveCoco`, manifest: "/manifest.webmanifest", icons: { icon: [{ url: "/icon.svg", type: "image/svg+xml" }] }, alternates: { languages: { ta: "/ta", en: "/en" } } };
}
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#2e7d32" };

export default async function BoardLayout({ children, params }: Props) {
  const { lang } = await params;
  return (
    <html lang={isLocale(lang) ? lang : DEFAULT_LOCALE}>
      <body>{children}<ServiceWorker /></body>
    </html>
  );
}
