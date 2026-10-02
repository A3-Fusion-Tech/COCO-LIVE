import { parseLocale } from "../../../packages/localization/src/index.ts";
import { renderPricesPage, type PriceItem } from "./render.ts";

/**
 * Framework-free web tier handlers on the Fetch API (`Request` → `Response`). The Next.js route handlers in
 * `apps/web/app` are thin wrappers around these, so they are unit-testable without a Next build.
 * The API session token never reaches JavaScript: it lives in an HttpOnly, SameSite=Strict cookie and is
 * attached server-side. Mutations must carry `x-requested-with` (a header cross-site forms cannot set).
 */
export interface GatewayConfig { apiBaseUrl: string; secureCookies: boolean; fetchImpl?: typeof fetch }

/** Runtime configuration from the environment (read per request, never inlined at build time). */
export function gatewayConfig(env: Record<string, string | undefined> = process.env): GatewayConfig {
  const secure = env.COOKIE_SECURE;
  return { apiBaseUrl: (env.API_BASE_URL ?? "http://localhost:4000").replace(/\/$/, ""), secureCookies: secure ? secure === "1" || secure === "true" : env.NODE_ENV === "production" };
}

export const SESSION_COOKIE = "lc_session";
const MAX_BODY = 13_000_000;
const PROXIED_REQUEST_HEADERS = ["content-type", "idempotency-key", "if-match", "accept-language", "x-correlation-id"];
const DROPPED_RESPONSE_HEADERS = new Set(["transfer-encoding", "connection", "keep-alive", "set-cookie", "content-encoding", "content-length"]);

const json = (status: number, body: unknown, extra: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store", "x-content-type-options": "nosniff", ...extra } });
const csrf = () => json(403, { code: "CSRF", title: "Missing x-requested-with header" });
const cookie = (req: Request, name: string) => {
  for (const part of (req.headers.get("cookie") ?? "").split(";")) {
    const [k, v] = part.trim().split("=");
    if (k === name && v !== undefined) { try { return decodeURIComponent(v); } catch { return undefined; } }
  }
  return undefined;
};
/** The client address as seen by the web tier (the custom server overwrites any client-sent value). */
const clientIp = (req: Request) => (req.headers.get("x-forwarded-for") ?? "").split(",")[0]?.trim() ?? "";
async function readBody(req: Request): Promise<ArrayBuffer | null> {
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY) return null;
  const buf = await req.arrayBuffer();
  return buf.byteLength > MAX_BODY ? null : buf;
}

/** POST /session/verify: verifies the OTP upstream and stores the token in the session cookie only. */
export async function verifySession(req: Request, cfg: GatewayConfig): Promise<Response> {
  if (!req.headers.get("x-requested-with")) return csrf();
  const f = cfg.fetchImpl ?? fetch;
  const r = await f(`${cfg.apiBaseUrl}/v1/auth/otp/verify`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": clientIp(req) }, body: await req.text() });
  const body = (await r.json().catch(() => ({}))) as { token?: string; user?: unknown };
  if (!r.ok || !body.token) return json(r.status, body);
  const flags = `HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000${cfg.secureCookies ? "; Secure" : ""}`;
  return json(200, { user: body.user }, { "set-cookie": `${SESSION_COOKIE}=${encodeURIComponent(body.token)}; ${flags}` });
}

/** POST /session/logout: clears the session cookie. */
export function logout(req: Request): Response {
  if (!req.headers.get("x-requested-with")) return csrf();
  return json(200, { ok: true }, { "set-cookie": `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0` });
}

/** /v1/*: same-origin proxy that attaches the session and blocks cross-site mutations and internal routes. */
export async function proxyApi(req: Request, cfg: GatewayConfig): Promise<Response> {
  const url = new URL(req.url);
  const mutating = !["GET", "HEAD"].includes(req.method);
  const isSignedUpload = req.method === "PUT" && url.pathname.startsWith("/v1/uploads/");
  if (mutating && !isSignedUpload && !req.headers.get("x-requested-with")) return csrf();
  if (url.pathname.startsWith("/v1/internal/")) return new Response(null, { status: 404 });
  const headers: Record<string, string> = {};
  for (const h of PROXIED_REQUEST_HEADERS) { const v = req.headers.get(h); if (v) headers[h] = v; }
  const token = cookie(req, SESSION_COOKIE);
  if (token) headers.authorization = `Bearer ${token}`;
  headers["x-forwarded-for"] = clientIp(req);
  let body: ArrayBuffer | null | undefined;
  if (mutating) { body = await readBody(req); if (body === null) return json(413, { code: "PAYLOAD_TOO_LARGE", title: "Request body too large" }); }
  let up: Response;
  try { up = await (cfg.fetchImpl ?? fetch)(cfg.apiBaseUrl + url.pathname + url.search, { method: req.method, headers, redirect: "manual", ...(body ? { body } : {}) }); }
  catch { return json(503, { code: "UNAVAILABLE", title: "API unreachable" }); }
  const out = new Headers();
  up.headers.forEach((v, k) => { if (!DROPPED_RESPONSE_HEADERS.has(k)) out.append(k, v); });
  return new Response(req.method === "HEAD" || [204, 304].includes(up.status) ? null : up.body, { status: up.status, statusText: up.statusText, headers: out });
}

/** GET /: the public server-rendered price page (cacheable for a minute; 503 while the API is down). */
export async function pricePage(req: Request, cfg: GatewayConfig): Promise<Response> {
  const locale = parseLocale(req.headers.get("accept-language") ?? undefined, new URL(req.url).searchParams.get("lang"));
  const f = cfg.fetchImpl ?? fetch;
  const get = async (path: string) => { const r = await f(cfg.apiBaseUrl + path, {}); if (!r.ok) throw new Error(`${path}: ${r.status}`); return r.json(); };
  try {
    const [prices, msp] = await Promise.all([get("/v1/prices/latest"), get("/v1/prices/msp")]);
    const html = renderPricesPage((prices as { items: PriceItem[] }).items, (msp as { items: never[] }).items, locale);
    return new Response(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=60", "content-security-policy": "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'", "vary": "accept-language" } });
  } catch {
    return new Response("Prices temporarily unavailable", { status: 503, headers: { "content-type": "text/plain; charset=utf-8", "retry-after": "30", "cache-control": "no-store" } });
  }
}

/** Offline service worker: network-first, falling back to the cache for the app shell, assets and public prices. */
export const SERVICE_WORKER = `const C="lc-v3";const SHELL=["/app/","/app/icon.svg"];
self.addEventListener("install",e=>e.waitUntil(caches.open(C).then(c=>c.addAll(SHELL))));
self.addEventListener("activate",e=>e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==C).map(x=>caches.delete(x))))));
self.addEventListener("fetch",e=>{const u=new URL(e.request.url);if(e.request.method!=="GET"||u.origin!==location.origin)return;
if(u.pathname.startsWith("/v1/")&&!u.pathname.startsWith("/v1/prices")&&!u.pathname.startsWith("/v1/sell-lots"))return;
e.respondWith(fetch(e.request).then(r=>{if(r.ok&&!r.redirected){const c=r.clone();caches.open(C).then(x=>x.put(e.request,c))}return r}).catch(()=>caches.match(e.request)))})`;

export const serviceWorker = () => new Response(SERVICE_WORKER, { headers: { "content-type": "text/javascript; charset=utf-8", "service-worker-allowed": "/", "cache-control": "no-cache" } });

export const manifest = (req: Request) => {
  const lang = parseLocale(req.headers.get("accept-language") ?? undefined, new URL(req.url).searchParams.get("lang"));
  return new Response(JSON.stringify({ name: "LiveCoco", short_name: "LiveCoco", start_url: "/app/", scope: "/", display: "standalone", lang, background_color: "#ffffff", theme_color: "#2e7d32", icons: [{ src: "/app/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }] }), { headers: { "content-type": "application/manifest+json" } });
};

export const health = () => json(200, { status: "ok" });

/** CSP for the authenticated app: scripts only from this origin or carrying the per-request nonce. `next dev` alone also needs eval and inline styles (error overlay, HMR). */
export const appCsp = (nonce: string, dev = false) => `default-src 'self'; img-src 'self' blob: data:; style-src 'self'${dev ? " 'unsafe-inline'" : ""}; script-src 'self' 'nonce-${nonce}'${dev ? " 'unsafe-eval'" : ""}; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`;
