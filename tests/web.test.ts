// Web tier unit tests (apps/web): gateway proxy, session cookie, API client, i18n, price view model, CSP, proxy.ts.
// No Next build and no API process: upstream calls go to stub `fetch` implementations.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { NextRequest } from "next/server.js";
import { ApiClient } from "../apps/web/lib/api/client.ts";
import { ApiError, describeProblem } from "../apps/web/lib/api/errors.ts";
import type { PriceItem } from "../apps/web/lib/api/types.ts";
import { clientIp, gatewayConfig, type GatewayConfig } from "../apps/web/lib/gateway/config.ts";
import { MAX_PROXY_BODY, proxyApi } from "../apps/web/lib/gateway/proxy.ts";
import { SESSION_COOKIE, readCookie, safeNextPath, serializeSessionCookie, sessionCookieOptions } from "../apps/web/lib/gateway/session.ts";
import { localIso, toPaise } from "../apps/web/lib/format.ts";
import { fields } from "../apps/web/lib/forms.ts";
import { missingUiKeys, resolveLocale, statusLabel, translator } from "../apps/web/lib/i18n/index.ts";
import { mspLine, priceCardView } from "../apps/web/lib/prices.ts";
import { appCsp, boardCsp, newNonce } from "../apps/web/lib/security/csp.ts";
import manifest from "../apps/web/app/manifest.ts";
import { proxy } from "../apps/web/proxy.ts";

interface Call { url: string; init: RequestInit; headers: Record<string, string> }
/** A stub upstream that records calls and answers with `respond`. */
function upstream(respond: (c: Call) => Response = () => Response.json({ ok: true })) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string | URL | Request, init: RequestInit = {}) => {
    const c = { url: String(url), init, headers: Object.fromEntries(new Headers(init.headers).entries()) };
    calls.push(c);
    return respond(c);
  }) as typeof fetch;
  return { calls, fetchImpl };
}
const cfg = (over: Partial<GatewayConfig> = {}): GatewayConfig => ({ apiBaseUrl: "http://api", secureCookies: true, trustProxy: false, ...over });
const req = (method: string, path: string, init: { body?: string | Uint8Array; headers?: Record<string, string> } = {}) =>
  new Request(`http://web${path}`, { method, headers: init.headers ?? {}, ...(init.body !== undefined ? { body: init.body } : {}) });

test("gateway config is read from the environment at runtime", () => {
  assert.equal(gatewayConfig({}).apiBaseUrl, "http://localhost:4000");
  assert.equal(gatewayConfig({ API_BASE_URL: "http://api:4000/" }).apiBaseUrl, "http://api:4000");
  assert.equal(gatewayConfig({ NODE_ENV: "production" }).secureCookies, true);
  assert.equal(gatewayConfig({ NODE_ENV: "production", COOKIE_SECURE: "0" }).secureCookies, false);
  assert.equal(gatewayConfig({ COOKIE_SECURE: "1" }).secureCookies, true);
  assert.equal(gatewayConfig({}).trustProxy, false);
  assert.equal(gatewayConfig({ TRUST_PROXY: "1" }).trustProxy, true);
});

test("client address: never taken from a client-controlled header unless a trusted proxy appended it", () => {
  const h = new Headers({ "x-forwarded-for": "6.6.6.6, 203.0.113.9" });
  assert.equal(clientIp(h, { trustProxy: false }), undefined, "without TRUST_PROXY nothing is forwarded");
  assert.equal(clientIp(h, { trustProxy: true }), "203.0.113.9", "the entry appended by the trusted proxy (last), not the client's own (first)");
  assert.equal(clientIp(new Headers({ "x-forwarded-for": "2001:db8::1" }), { trustProxy: true }), "2001:db8::1");
  assert.equal(clientIp(new Headers({ "x-forwarded-for": "<script>" }), { trustProxy: true }), undefined);
  assert.equal(clientIp(new Headers(), { trustProxy: true }), undefined);
});

test("/v1 proxy: session from the cookie, CSRF header on mutations, internal routes hidden, upstream cookies dropped", async () => {
  const up = upstream(() => new Response('{"ok":true}', { status: 200, headers: { "content-type": "application/json", "set-cookie": "evil=1", "x-correlation-id": "req_1" } }));
  const c = cfg({ fetchImpl: up.fetchImpl });
  const session = `${SESSION_COOKIE}=tok%2B1; other=x`;

  const me = await proxyApi(req("GET", "/v1/me?lang=en", { headers: { cookie: session, "x-forwarded-for": "6.6.6.6", authorization: "Bearer spoofed", "accept-language": "ta" } }), c);
  assert.equal(me.status, 200);
  assert.equal(me.headers.get("set-cookie"), null, "upstream set-cookie is stripped");
  assert.equal(me.headers.get("x-correlation-id"), "req_1");
  assert.equal(up.calls[0]?.url, "http://api/v1/me?lang=en");
  assert.equal(up.calls[0]?.headers.authorization, "Bearer tok+1", "token comes from the HttpOnly cookie only");
  assert.equal(up.calls[0]?.headers["x-forwarded-for"], undefined, "a client-sent x-forwarded-for is not passed on");
  assert.equal(up.calls[0]?.headers["accept-language"], "ta");
  assert.equal(up.calls[0]?.headers.cookie, undefined, "cookies are not forwarded upstream");

  const csrf = await proxyApi(req("POST", "/v1/alerts", { body: "{}", headers: { cookie: session, "content-type": "application/json" } }), c);
  assert.equal(csrf.status, 403, "mutations need x-requested-with");
  assert.equal(((await csrf.json()) as { code: string }).code, "CSRF");
  assert.equal(up.calls.length, 1, "a refused mutation never reaches the API");

  const ok = await proxyApi(req("POST", "/v1/alerts", { body: '{"a":1}', headers: { cookie: session, "content-type": "application/json", "x-requested-with": "x", "idempotency-key": "k1" } }), c);
  assert.equal(ok.status, 200);
  assert.equal(up.calls[1]?.headers["idempotency-key"], "k1");
  assert.equal(new TextDecoder().decode(up.calls[1]?.init.body as ArrayBuffer), '{"a":1}');

  assert.equal((await proxyApi(req("POST", "/v1/internal/tick", { body: "{}", headers: { "x-requested-with": "t" } }), c)).status, 404);
  assert.equal((await proxyApi(req("GET", "/v1/internal/tick"), c)).status, 404);
  assert.equal(up.calls.length, 2, "internal routes never reach the API");

  const upload = await proxyApi(req("PUT", "/v1/uploads/media_1?exp=1&sig=x", { body: new Uint8Array([1, 2, 3]), headers: { "content-type": "image/png" } }), c);
  assert.equal(upload.status, 200, "signed upload PUTs pass without the CSRF header; the API checks the signature");
  assert.equal(up.calls[2]?.url, "http://api/v1/uploads/media_1?exp=1&sig=x");

  const big = await proxyApi(req("POST", "/v1/alerts", { body: "x", headers: { "x-requested-with": "t", "content-length": String(MAX_PROXY_BODY + 1) } }), c);
  assert.equal(big.status, 413);

  const down = await proxyApi(req("GET", "/v1/prices/latest"), cfg({ fetchImpl: (async () => { throw new TypeError("fetch failed"); }) as typeof fetch }));
  assert.equal(down.status, 503);
});

test("/v1 proxy forwards the client address only from a trusted proxy", async () => {
  const up = upstream();
  await proxyApi(req("GET", "/v1/prices/latest", { headers: { "x-forwarded-for": "6.6.6.6, 198.51.100.7" } }), cfg({ fetchImpl: up.fetchImpl, trustProxy: true }));
  assert.equal(up.calls[0]?.headers["x-forwarded-for"], "198.51.100.7");
});

test("session cookie is HttpOnly, SameSite=Strict, Secure in production, and cleared on logout", () => {
  assert.deepEqual(sessionCookieOptions(true), { httpOnly: true, sameSite: "strict", secure: true, path: "/", maxAge: 2592000 });
  assert.equal(serializeSessionCookie("a b", sessionCookieOptions(true)), "lc_session=a%20b; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000; Secure");
  assert.match(serializeSessionCookie("", sessionCookieOptions(false, 0)), /^lc_session=; HttpOnly; SameSite=Strict; Path=\/; Max-Age=0$/);
  assert.equal(readCookie("a=1; lc_session=t%3D1; b=2", SESSION_COOKIE), "t=1");
  assert.equal(readCookie("lc_session_x=1", SESSION_COOKIE), undefined);
  assert.equal(readCookie("lc_session=%E0%A4%A", SESSION_COOKIE), undefined);
});

test("post-login redirect stays on this origin", () => {
  assert.equal(safeNextPath("/deals/d1?x=1"), "/deals/d1?x=1");
  for (const bad of ["https://evil.example", "//evil.example", "/\\evil.example", "javascript:alert(1)", "/ok\r\nx", "", null, undefined]) assert.equal(safeNextPath(bad, "/market"), "/market", String(bad));
});

test("API client: bearer token, locale, idempotency keys, problem+json and an unreachable API", async () => {
  const up = upstream((c) => (c.url.endsWith("/v1/me") ? Response.json({ userId: "u1" }) : new Response(JSON.stringify({ status: 409, code: "OFFER_EXPIRED", message: "This offer has expired.", correlationId: "req_9" }), { status: 409, headers: { "content-type": "application/problem+json" } })));
  const api = new ApiClient({ baseUrl: "http://api/", token: "tok", locale: "ta", clientIp: "203.0.113.9", fetchImpl: up.fetchImpl });
  assert.deepEqual(await api.me(), { userId: "u1" });
  assert.equal(up.calls[0]?.url, "http://api/v1/me");
  assert.equal(up.calls[0]?.headers.authorization, "Bearer tok");
  assert.equal(up.calls[0]?.headers["accept-language"], "ta");
  assert.equal(up.calls[0]?.headers["x-forwarded-for"], "203.0.113.9");
  assert.equal(up.calls[0]?.headers["idempotency-key"], undefined, "reads carry no idempotency key");
  assert.equal((up.calls[0]?.init as { cache?: string }).cache, "no-store", "authenticated reads are never cached");

  const err = await api.post("/v1/offers/o1/accept", {}, { idempotencyKey: "accept-o1" }).catch((e: unknown) => e);
  assert.ok(err instanceof ApiError);
  assert.equal(err.status, 409);
  assert.equal(err.code, "OFFER_EXPIRED");
  assert.equal(err.problem.correlationId, "req_9");
  assert.equal(up.calls[1]?.headers["idempotency-key"], "accept-o1");
  assert.equal(up.calls[1]?.headers["content-type"], "application/json");
  await api.post("/v1/alerts", { a: 1 }).catch(() => undefined);
  assert.match(up.calls[2]?.headers["idempotency-key"] ?? "", /^[0-9a-f-]{36}$/, "other mutations get a fresh key");

  const pub = new ApiClient({ baseUrl: "http://api", fetchImpl: up.fetchImpl });
  await pub.catalog({ revalidate: 3600 }).catch(() => undefined);
  assert.deepEqual((up.calls[3]?.init as { next?: unknown }).next, { revalidate: 3600 }, "public reads may use the Next data cache");

  const down = new ApiClient({ baseUrl: "http://api", fetchImpl: (async () => { throw new TypeError("fetch failed"); }) as typeof fetch });
  const unreachable = await down.latestPrices().catch((e: unknown) => e);
  assert.ok(unreachable instanceof ApiError && unreachable.status === 503 && unreachable.code === "UNAVAILABLE");

  const html = new ApiClient({ baseUrl: "http://api", fetchImpl: (async () => new Response("<h1>Bad gateway</h1>", { status: 502 })) as typeof fetch });
  const bad = await html.me().catch((e: unknown) => e);
  assert.ok(bad instanceof ApiError && bad.status === 502, "non-JSON errors still become ApiError");

  assert.equal(describeProblem({ status: 400, message: "Some fields are invalid.", fieldErrors: [{ field: "quantity" }, { field: "unit" }] }, "x"), "Some fields are invalid.: quantity, unit");
  assert.equal(describeProblem({ status: 400, code: "VALIDATION_FAILED", detail: "MIN_EXCEEDS_TARGET" }, "x"), "MIN_EXCEEDS_TARGET");
  assert.equal(describeProblem({ status: 500 }, "Something went wrong"), "Something went wrong");
});

test("locale: ?lang= then cookie then Accept-Language, Tamil by default; catalogs in step", () => {
  assert.equal(resolveLocale({}), "ta");
  assert.equal(resolveLocale({ acceptLanguage: "en-IN,en;q=0.9" }), "en");
  assert.equal(resolveLocale({ acceptLanguage: "ta-IN" }), "ta");
  assert.equal(resolveLocale({ acceptLanguage: "fr-FR" }), "ta");
  assert.equal(resolveLocale({ cookie: "ta", acceptLanguage: "en-IN" }), "ta");
  assert.equal(resolveLocale({ query: "en", cookie: "ta" }), "en");
  assert.equal(resolveLocale({ query: "xx", cookie: "en" }), "en");
  assert.deepEqual(missingUiKeys(), [{ locale: "ta", keys: [] }, { locale: "en", keys: [] }]);
  const ta = translator("ta");
  assert.equal(ta("nav.prices"), "விலைகள்");
  assert.equal(ta("price.not_offer").includes("உத்தரவாதமான"), true, "falls back to the shared domain catalog");
  assert.equal(ta("no.such.key"), "no.such.key");
  assert.equal(statusLabel(translator("en"), "PAYMENT_CONFIRMED"), "Payment confirmed");
  assert.equal(statusLabel(translator("en"), "SOMETHING_NEW"), "SOMETHING_NEW");
});

const PRICE: PriceItem = {
  priceAggregateId: null, kind: "OFFICIAL_OBSERVATION_ONLY",
  product: { productId: "prod_mature_coconut", name: "Mature coconut", nameTa: "முற்றிய தேங்காய்" },
  market: { marketId: "market_pollachi", name: "Pollachi", nameTa: "பொள்ளாச்சி" },
  stage: "REGULATED_MARKET", tradeTerm: "AT_MARKET", gradeGroup: "FAQ",
  range: { low: { amountPaise: 2900, currency: "INR" }, reference: { amountPaise: 3050, currency: "INR" }, high: { amountPaise: 3200, currency: "INR" }, perUnit: "QUINTAL" },
  observedWindow: { startsAt: "2026-10-01T04:00:00Z", endsAt: "2026-10-01T04:00:00Z" },
  freshness: "CURRENT", confidence: "LOW", messageKey: "price.insufficient",
  evidenceSummary: { observations: 1, independentOrganizations: 1, officialMarketObservations: 1, verifiedQuotes: 0, completedTrades: 0 },
  calculationVersion: null,
};

test("price board cards: Tamil/English names, range, freshness, evidence and notes as text", () => {
  const en = priceCardView(PRICE, "en");
  assert.equal(en.title, "Mature coconut · Pollachi");
  assert.equal(en.meta, "Regulated market · At market · FAQ · quintal");
  assert.deepEqual(en.range.map((r) => r.label), ["Low", "Reference", "High"]);
  assert.match(en.range[1]?.value ?? "", /₹\s?30\.50/);
  assert.equal(en.status, "Current · Low confidence");
  assert.match(en.reported, /^Reported at /);
  assert.match(en.note ?? "", /No current verified range/);
  assert.deepEqual(en.bucket, { productId: "prod_mature_coconut", marketId: "market_pollachi", unit: "QUINTAL", stage: "REGULATED_MARKET" });
  const ta = priceCardView(PRICE, "ta");
  assert.equal(ta.title, "முற்றிய தேங்காய் · பொள்ளாச்சி");
  const stale = priceCardView({ ...PRICE, freshness: "STALE", messageKey: "price.stale" }, "en");
  assert.match(stale.reported, /^Last reported for /);
  assert.match(stale.status, /^Stale/);
  assert.equal(priceCardView({ ...PRICE, messageKey: null }, "en").note, null);
  const catalog = { products: [{ productId: "prod_milling_copra" as const, name: { en: "Milling copra", ta: "கொப்பரை (ஆலை)" }, units: [], stages: [], requiredAttributes: [] }], markets: [] };
  assert.match(mspLine({ productId: "prod_milling_copra", unit: "QUINTAL", amountPaise: 1_133_500, seasonLabel: "2026" }, "en", catalog), /^Milling copra: ₹\s?11,335 \/ quintal — 2026$/);
});

test("form input: rupees to paise exactly, datetime-local read as Indian time", () => {
  assert.equal(toPaise("30"), 3000);
  assert.equal(toPaise(" 30.5 "), 3050);
  assert.equal(toPaise("0.07"), 7);
  assert.throws(() => toPaise("3e2"), (e: unknown) => e instanceof ApiError && e.status === 400);
  assert.throws(() => toPaise("-1"), ApiError);
  assert.equal(localIso("2026-10-28T09:30"), "2026-10-28T04:00:00.000Z");
  assert.throws(() => localIso("tomorrow"), ApiError);
  const form = new FormData();
  form.append("q", " 5 "); form.append("ok", "on"); form.append("ids", "a"); form.append("ids", "b"); form.append("$ACTION_ID_x", "");
  const f = fields(form);
  assert.equal(f.str("q"), "5");
  assert.equal(f.bool("ok"), true);
  assert.equal(f.bool("missing"), false);
  assert.deepEqual(f.all("ids"), ["a", "b"]);
  assert.equal("$ACTION_ID_x" in f.values(), false, "framework fields are not echoed back to forms");
});

test("CSP: per-request nonce for app pages, no inline/eval in production; board policy is static", () => {
  const a = newNonce();
  assert.notEqual(a, newNonce());
  assert.match(a, /^[A-Za-z0-9+/]{22}==$/);
  const prod = appCsp(a);
  assert.match(prod, new RegExp(`script-src 'self' 'nonce-${a.replace(/[+/]/g, "\\$&")}'(;|$)`));
  assert.doesNotMatch(prod, /unsafe-inline|unsafe-eval/);
  for (const d of ["object-src 'none'", "frame-ancestors 'none'", "base-uri 'none'", "form-action 'self'", "connect-src 'self'"]) assert.ok(prod.includes(d), d);
  assert.match(appCsp(a, true), /'unsafe-eval'/);
  assert.match(boardCsp(), /script-src 'self' 'unsafe-inline'/);
  assert.doesNotMatch(boardCsp(), /unsafe-eval/);
});

test("proxy.ts: board redirect by language, lang cookie, login gate, nonce CSP and locale header", () => {
  const run = (path: string, headers: Record<string, string> = {}) => proxy(new NextRequest(`http://web${path}`, { headers }));
  const root = run("/", { "accept-language": "en-IN" });
  assert.equal(root.status, 307);
  assert.equal(root.headers.get("location"), "http://web/en");
  assert.equal(run("/").headers.get("location"), "http://web/ta", "Tamil first");
  assert.equal(run("/", { cookie: "lc_lang=en" }).headers.get("location"), "http://web/en");
  const pick = run("/?lang=ta", { cookie: "lc_lang=en" });
  assert.equal(pick.headers.get("location"), "http://web/ta");
  assert.match(pick.headers.get("set-cookie") ?? "", /^lc_lang=ta; Path=\/;.*SameSite=lax/i);

  const board = run("/en");
  assert.equal(board.headers.get("content-security-policy"), boardCsp());

  const gated = run("/deals/d1?x=1");
  assert.equal(gated.status, 307);
  assert.equal(gated.headers.get("location"), "http://web/login?next=%2Fdeals%2Fd1%3Fx%3D1");
  assert.notEqual(run("/deals", { cookie: "lc_session=t" }).status, 307);

  const page = run("/market?lang=en", { cookie: "lc_lang=ta", "x-lc-locale": "ta" });
  const csp = page.headers.get("content-security-policy") ?? "";
  assert.match(csp, /script-src 'self' 'nonce-[^']+'(;|$)/);
  assert.notEqual(csp, run("/market").headers.get("content-security-policy"), "a fresh nonce per request");
  // Overridden request headers are passed to the page as `x-middleware-request-*`.
  assert.equal(page.headers.get("x-middleware-request-x-lc-locale"), "en", "the resolved locale overrides any client-sent value");
  assert.equal(page.headers.get("x-middleware-request-x-lc-path"), "/market?lang=en");
  assert.equal(page.headers.get("x-middleware-request-content-security-policy"), csp, "Next reads the nonce from the request CSP");
});

test("PWA: manifest, offline service worker that never caches signed-in pages", async () => {
  const m = manifest();
  assert.equal(m.start_url, "/");
  assert.equal(m.lang, "ta");
  assert.equal(m.display, "standalone");
  const sw = await readFile(new URL("../apps/web/public/sw.js", import.meta.url), "utf8");
  assert.match(sw, /caches\.match/);
  assert.match(sw, /PUBLIC_PAGES = new Set\(\["\/", "\/ta", "\/en", "\/market"\]\)/);
  assert.doesNotMatch(sw, /"\/(deals|me|sell|buy|ops|alerts)/);
});
