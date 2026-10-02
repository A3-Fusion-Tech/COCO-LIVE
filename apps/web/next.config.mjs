// Next.js configuration for the web tier. The app imports the monorepo's TypeScript packages directly
// (`../../packages/*/src/*.ts`), so the build root is the repository root.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** @type {import("next").NextConfig} */
export default {
  poweredByHeader: false,
  reactStrictMode: true,
  // `/app/` is the canonical app URL (manifest start_url, service worker shell); the proxy redirects `/app`.
  skipTrailingSlashRedirect: true,
  turbopack: { root },
  outputFileTracingRoot: root,
  experimental: { externalDir: true },
  async headers() {
    return [{ source: "/:path*", headers: [{ key: "x-content-type-options", value: "nosniff" }] }];
  },
};
