import { createServer, type Server } from "node:http";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** `next` is CommonJS (`module.exports = createServer`); require it so typing and runtime agree under nodenext. */
const next = createRequire(import.meta.url)("next") as typeof import("next").default;

const WEB_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");

export interface WebOptions { apiBaseUrl?: string; secureCookies?: boolean; dev?: boolean; dir?: string }

/**
 * Boots the Next.js web tier (production build by default; run `npm run build:web` first) behind a plain
 * `node:http` server. The gateway configuration is read from the environment per request, so the options
 * are written there. `x-forwarded-for` is overwritten with the socket address so clients cannot spoof
 * the address the API rate-limits on.
 */
export async function createWeb(opts: WebOptions = {}): Promise<Server> {
  if (opts.apiBaseUrl) process.env.API_BASE_URL = opts.apiBaseUrl;
  if (opts.secureCookies !== undefined) process.env.COOKIE_SECURE = opts.secureCookies ? "1" : "0";
  const dev = opts.dev ?? false;
  if (!process.env.NODE_ENV) Object.assign(process.env, { NODE_ENV: dev ? "development" : "production" });
  const app = next({ dev, dir: opts.dir ?? WEB_DIR });
  await app.prepare();
  const handle = app.getRequestHandler();
  return createServer((req, res) => {
    req.headers["x-forwarded-for"] = req.socket.remoteAddress ?? "";
    handle(req, res).catch(() => { if (!res.headersSent) res.writeHead(500); res.end("Error"); });
  });
}

if (process.argv[1]?.endsWith("server.ts")) {
  const port = Number(process.env.PORT ?? 3000);
  const web = await createWeb();
  web.listen(port, () => console.log(`web listening on ${port}`));
}
