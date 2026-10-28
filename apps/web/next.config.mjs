// Next.js configuration for the web tier. The app imports the monorepo's TypeScript workspace packages
// (`@livecoco/*`), so the build root is the repository root.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** @type {import("next").NextConfig} */
export default {
  poweredByHeader: false,
  reactStrictMode: true,
  turbopack: { root },
  outputFileTracingRoot: root,
  transpilePackages: ["@livecoco/localization"],
  async redirects() {
    // The previous PWA lived at `/app/` with hash routes; installed copies and bookmarks still open it.
    return [{ source: "/app", destination: "/", permanent: true }, { source: "/app/:path*", destination: "/", permanent: true }];
  },
  async headers() {
    return [{ source: "/:path*", headers: [{ key: "x-content-type-options", value: "nosniff" }, { key: "referrer-policy", value: "strict-origin-when-cross-origin" }] }];
  },
};
