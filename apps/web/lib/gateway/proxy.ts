import { clientIp, type GatewayConfig } from "./config.ts";
import { SESSION_COOKIE, readCookie } from "./session.ts";

export const MAX_PROXY_BODY = 13_000_000;
const FORWARDED_REQUEST_HEADERS = ["content-type", "idempotency-key", "if-match", "accept-language", "x-correlation-id"];
const DROPPED_RESPONSE_HEADERS = new Set(["transfer-encoding", "connection", "keep-alive", "set-cookie", "content-encoding", "content-length"]);

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/problem+json", "cache-control": "no-store", "x-content-type-options": "nosniff" } });

/** Signed upload URLs (`PUT /v1/uploads/:id?exp=&sig=`) are authorised by their signature, not the session. */
const isSignedUpload = (method: string, pathname: string) => method === "PUT" && pathname.startsWith("/v1/uploads/");

async function readBody(req: Request): Promise<ArrayBuffer | null> {
  if (Number(req.headers.get("content-length") ?? 0) > MAX_PROXY_BODY) return null;
  const buf = await req.arrayBuffer();
  return buf.byteLength > MAX_PROXY_BODY ? null : buf;
}

/**
 * `/v1/*` on the web origin: a same-origin proxy to the API for browser code (signed photo uploads, the offline
 * service worker's price reads) and for anything else that wants the API without CORS.
 * - attaches `Authorization: Bearer` from the HttpOnly session cookie;
 * - refuses mutations without `x-requested-with` (a header cross-site forms cannot send), except signed uploads;
 * - answers 404 for `/v1/internal/*`;
 * - forwards only an allow-list of request headers, plus a client address only from a trusted proxy;
 * - drops `set-cookie` and hop-by-hop headers from upstream, caps request bodies and streams responses.
 */
export async function proxyApi(req: Request, cfg: GatewayConfig): Promise<Response> {
  const url = new URL(req.url);
  const mutating = req.method !== "GET" && req.method !== "HEAD";
  if (mutating && !isSignedUpload(req.method, url.pathname) && !req.headers.get("x-requested-with")) return json(403, { status: 403, code: "CSRF", title: "Missing x-requested-with header" });
  if (url.pathname === "/v1/internal" || url.pathname.startsWith("/v1/internal/")) return new Response(null, { status: 404 });
  const headers: Record<string, string> = {};
  for (const h of FORWARDED_REQUEST_HEADERS) { const v = req.headers.get(h); if (v) headers[h] = v; }
  const token = readCookie(req.headers.get("cookie"), SESSION_COOKIE);
  if (token) headers.authorization = `Bearer ${token}`;
  const ip = clientIp(req.headers, cfg);
  if (ip) headers["x-forwarded-for"] = ip;
  let body: ArrayBuffer | null | undefined;
  if (mutating) {
    body = await readBody(req);
    if (body === null) return json(413, { status: 413, code: "PAYLOAD_TOO_LARGE", title: "Request body too large" });
  }
  let up: Response;
  try {
    up = await (cfg.fetchImpl ?? fetch)(cfg.apiBaseUrl + url.pathname + url.search, { method: req.method, headers, redirect: "manual", ...(body ? { body } : {}) });
  } catch {
    return json(503, { status: 503, code: "UNAVAILABLE", title: "API unreachable" });
  }
  const out = new Headers();
  up.headers.forEach((v, k) => { if (!DROPPED_RESPONSE_HEADERS.has(k)) out.append(k, v); });
  return new Response(req.method === "HEAD" || up.status === 204 || up.status === 304 ? null : up.body, { status: up.status, statusText: up.statusText, headers: out });
}
