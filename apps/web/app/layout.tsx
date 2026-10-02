import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: "LiveCoco", manifest: "/manifest.webmanifest", icons: { icon: [{ url: "/app/icon.svg", type: "image/svg+xml" }] } };
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#2e7d32" };

/** Root layout for the React pages (only `/app/`; the public price page and the gateway are Route Handlers). */
export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="ta"><body>{children}</body></html>;
}
