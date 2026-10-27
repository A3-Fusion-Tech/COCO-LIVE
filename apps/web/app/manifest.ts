import type { MetadataRoute } from "next";

/** PWA manifest (`/manifest.webmanifest`). Opens on the Tamil-first price board; the app is one tap away. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "LiveCoco — தேங்காய் விலைகள்",
    short_name: "LiveCoco",
    description: "Tamil Nadu coconut prices and verified B2B marketplace",
    start_url: "/",
    scope: "/",
    display: "standalone",
    lang: "ta",
    background_color: "#ffffff",
    theme_color: "#2e7d32",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
  };
}
