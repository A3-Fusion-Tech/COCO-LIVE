import { createServer, request as httpRequest, type IncomingMessage, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseLocale } from "../../../packages/localization/src/index.ts";
import { renderPricesPage, type PriceItem } from "./render.ts";

const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "public");
const TYPES: Record<string, string> = { ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".html": "text/html; charset=utf-8", ".svg": "image/svg+xml" };
const SW = `const C="lc-v2";const SHELL=["/app/","/app/app.js","/app/app.css","/app/i18n.js"];
self.addEventListener("install",e=>e.waitUntil(caches.open(C).then(c=>c.addAll(SHELL))));
self.addEventListener("fetch",e=>{const u=new URL(e.request.url);if(e.request.method!=="GET")return;
if(u.pathname.startsWith("/v1/")&&!u.pathname.startsWith("/v1/prices")&&!u.pathname.startsWith("/v1/sell-lots"))return;
e.respondWith(fetch(e.request).then(r=>{if(r.ok){const c=r.clone();caches.open(C).then(x=>x.put(e.request,c))}return r}).catch(()=>caches.match(e.request)))})`;
const manifest = (locale: string) => JSON.stringify({ name: "LiveCoco", short_name: "LiveCoco", start_url: "/app/", scope: "/", display: "standalone", lang: locale, background_color: "#ffffff", theme_color: "#2e7d32", icons: [{ src: "/app/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }] });

const SESSION_COOKIE = "lc_session";
const cookies = (req: IncomingMessage) => Object.fromEntries((req.headers.cookie ?? "").split(";").map((c) => c.trim().split("=")).filter((p) => p.length === 2).map(([k, v]) => [k, decodeURIComponent(v as string)])) as Record<string, string>;
const readAll = (req: IncomingMessage, max = 13_000_000) => new Promise<Buffer>((resolve, reject) => {
  const chunks: Buffer[] = []; let n = 0;
  req.on("data", (c: Buffer) => { n += c.length; if (n > max) { reject(new Error("too large")); req.destroy(); } else chunks.push(c); });
  req.on("end", () => resolve(Buffer.concat(chunks)));
  req.on("error", reject);
});

export interface WebOptions { apiBaseUrl: string; fetchImpl?: typeof fetch; secureCookies?: boolean }

/**
 * Web tier: SSR public price page, the installable PWA shell and a same-origin gateway to the API.
 * The API session token never reaches JavaScript: it lives in an HttpOnly, SameSite=Strict cookie and
 * is attached server-side. Mutations must carry `x-requested-with` (a header cross-site forms cannot set).
 */
export function createWeb(optsOrUrl: WebOptions | string, fetchArg?: typeof fetch): Server {
  const opts: WebOptions = typeof optsOrUrl === "string" ? { apiBaseUrl: optsOrUrl, ...(fetchArg ? { fetchImpl: fetchArg } : {}) } : optsOrUrl;
  const api = opts.apiBaseUrl;
  const f = opts.fetchImpl ?? fetch;
  const cookieFlags = `HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000${opts.secureCookies ? "; Secure" : ""}`;
  const json = (res: import("node:http").ServerResponse, status: number, body: unknown, extra: Record<string, string> = {}) => { res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store", "x-content-type-options": "nosniff", ...extra }); res.end(JSON.stringify(body)); };

  return createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    try {
      if (url.pathname === "/sw.js") { res.writeHead(200, { "content-type": "text/javascript", "service-worker-allowed": "/" }); return void res.end(SW); }
      if (url.pathname === "/manifest.webmanifest") { res.writeHead(200, { "content-type": "application/manifest+json" }); return void res.end(manifest(parseLocale(req.headers["accept-language"], url.searchParams.get("lang")))); }
      if (url.pathname === "/healthz") return json(res, 200, { status: "ok" });

      // ---- PWA shell ----
      if (url.pathname === "/app" ) { res.writeHead(301, { location: "/app/" }); return void res.end(); }
      if (url.pathname.startsWith("/app/")) {
        const name = url.pathname === "/app/" ? "index.html" : url.pathname.slice(5);
        if (!/^[a-z0-9.-]+$/i.test(name)) { res.writeHead(404); return void res.end("Not found"); }
        try {
          const body = await readFile(join(PUBLIC_DIR, name));
          const ext = name.slice(name.lastIndexOf("."));
          res.writeHead(200, { "content-type": TYPES[ext] ?? "application/octet-stream", "cache-control": "no-cache", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'self'; img-src 'self' blob: data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'" });
          return void res.end(body);
        } catch { res.writeHead(404); return void res.end("Not found"); }
      }
      // ---- session gateway ----
      if (url.pathname === "/session/verify" && req.method === "POST") {
        if (!req.headers["x-requested-with"]) return json(res, 403, { code: "CSRF" });
        const r = await f(`${api}/v1/auth/otp/verify`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": req.socket.remoteAddress ?? "" }, body: (await readAll(req)).toString("utf8") });
        const body = (await r.json()) as { token?: string; user?: unknown };
        if (!r.ok || !body.token) return json(res, r.status, body);
        return json(res, 200, { user: body.user }, { "set-cookie": `${SESSION_COOKIE}=${encodeURIComponent(body.token)}; ${cookieFlags}` });
      }
      if (url.pathname === "/session/logout" && req.method === "POST") {
        if (!req.headers["x-requested-with"]) return json(res, 403, { code: "CSRF" });
        return json(res, 200, { ok: true }, { "set-cookie": `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0` });
      }

      // ---- API gateway (same-origin; attaches the session; blocks cross-site mutations) ----
      if (url.pathname.startsWith("/v1/")) {
        const mutating = !["GET", "HEAD"].includes(req.method ?? "GET");
        const isSignedUpload = req.method === "PUT" && url.pathname.startsWith("/v1/uploads/");
        if (mutating && !isSignedUpload && !req.headers["x-requested-with"]) return json(res, 403, { code: "CSRF", title: "Missing x-requested-with header" });
        if (url.pathname.startsWith("/v1/internal/")) { res.writeHead(404); return void res.end(); }
        const token = cookies(req)[SESSION_COOKIE];
        const body = mutating ? await readAll(req) : undefined;
        const headers: Record<string, string> = {};
        for (const h of ["content-type", "idempotency-key", "if-match", "accept-language", "x-correlation-id"]) if (req.headers[h]) headers[h] = String(req.headers[h]);
        if (token) headers.authorization = `Bearer ${token}`;
        headers["x-forwarded-for"] = req.socket.remoteAddress ?? "";
        const target = new URL(api);
        const proxied = httpRequest({ hostname: target.hostname, port: target.port, path: url.pathname + url.search, method: req.method, headers: { ...headers, ...(body ? { "content-length": String(body.length) } : {}) } }, (up) => {
          const out: Record<string, string | string[]> = {};
          for (const [k, v] of Object.entries(up.headers)) if (v !== undefined && !["transfer-encoding", "connection", "set-cookie"].includes(k)) out[k] = v;
          res.writeHead(up.statusCode ?? 502, out);
          up.pipe(res);
        });
        proxied.on("error", () => json(res, 503, { code: "UNAVAILABLE", title: "API unreachable" }));
        proxied.end(body);
        return;
      }

      // ---- public SSR price page ----
      if (url.pathname !== "/") { res.writeHead(404); return void res.end("Not found"); }
      const locale = parseLocale(req.headers["accept-language"], url.searchParams.get("lang"));
      try {
        const [prices, msp] = await Promise.all([f(`${api}/v1/prices/latest`).then((r) => r.json()), f(`${api}/v1/prices/msp`).then((r) => r.json())]);
        res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=60", "content-security-policy": "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'" });
        res.end(renderPricesPage((prices as { items: PriceItem[] }).items, (msp as { items: never[] }).items, locale));
      } catch {
        res.writeHead(503, { "content-type": "text/plain; charset=utf-8", "retry-after": "30" });
        res.end("Prices temporarily unavailable");
      }
    } catch {
      if (!res.headersSent) { res.writeHead(500); res.end("Error"); }
    }
  });
}

if (process.argv[1]?.endsWith("server.ts")) {
  const port = Number(process.env.PORT ?? 3000);
  createWeb({ apiBaseUrl: process.env.API_BASE_URL ?? "http://localhost:4000", secureCookies: process.env.NODE_ENV === "production" }).listen(port, () => console.log(`web listening on ${port}`));
}
