# Web application

Next.js (App Router, React, TypeScript) web tier ([ADR-009](../../docs/decisions/009-nextjs-nestjs-flutter.md)):

- Public, server-rendered Tamil/English price page at `/`.
- The installable PWA at `/app/` for farmers, buyers, FPOs, partners and operators (prices, evidence and alerts; sign-in; market; sell; buy; offers and deals; FPO aggregation and settlement; partner workspace; operations console with OTP step-up).
- A same-origin gateway to the API that keeps the session out of JavaScript.

Implementation must follow [the product requirements](../../docs/product/requirements.md), [API conventions](../../docs/api/conventions.md) and [privacy controls](../../docs/security/privacy.md).

## Running

```text
API_BASE_URL=http://localhost:4000 npm run dev:web       # next dev on :3000 → http://localhost:3000/app/
npm run build:web && API_BASE_URL=http://localhost:4000 npm run start:web   # production build behind src/server.ts
```

Environment: `API_BASE_URL` (default `http://localhost:4000`), `PORT` (default 3000), `COOKIE_SECURE` (`1`/`0`; defaults to on when `NODE_ENV=production`). They are read per request, never inlined at build time. In development open `localhost`, not `127.0.0.1`: `next dev` blocks other origins from its dev resources unless they are listed in `allowedDevOrigins`.

`npm run start:web` runs `src/server.ts`, a small `node:http` wrapper around Next's production server (`next({ dev: false })`), rather than `next start`: it overwrites `x-forwarded-for` with the socket address so a client cannot choose the address the API rate-limits on (`next start` keeps a client-sent value). The e2e test boots the same server through `createWeb({ apiBaseUrl })`.

## Layout

| Path | What |
| --- | --- |
| `app/route.ts` | Public price page (`/`), rendered by `src/render.ts`. A Route Handler, not a page: App Router pages cannot answer `503 Prices temporarily unavailable` or send `cache-control: public, max-age=60`. Locale from `?lang=` then `Accept-Language` (`packages/localization`). |
| `app/app/page.tsx`, `app/app/_ui/*` | The PWA: a client-side shell with hash routes (`#/sell`, `#/deals/<id>`…), the Tamil/English toggle (`src/i18n.ts`) and one async page function per screen. Each page loads its data and is swapped in whole, so a reload resets local form state as before. |
| `app/session/verify`, `app/session/logout` | `POST /session/verify` proxies `/v1/auth/otp/verify` and stores the token only in the `lc_session` cookie (`HttpOnly; SameSite=Strict; Path=/`, `Secure` in production); the token is never returned to the page. |
| `app/v1/[...path]` | `/v1/*` proxy: attaches `Authorization: Bearer` from the cookie; forwards `content-type`, `idempotency-key`, `if-match`, `accept-language`, `x-correlation-id` and `x-forwarded-for`; requires `x-requested-with` on mutations except signed `PUT /v1/uploads/*`; answers 404 for `/v1/internal/*`; strips upstream `set-cookie`; streams binary media through. |
| `app/healthz`, `app/sw.js`, `app/manifest.webmanifest` | Health check, offline service worker (network-first; caches the shell, Next's static assets and public price/lot reads) and the localized web manifest. |
| `proxy.ts` | Redirects `/app` to `/app/` and sets the app's CSP with a fresh nonce per request. |
| `src/gateway.ts` | The framework-free `Request → Response` handlers behind the routes above; unit-tested in `tests/http.test.ts` without a Next build. |

## Content Security Policy

`/app/` is served with:

```text
default-src 'self'; img-src 'self' blob: data:; style-src 'self'; script-src 'self' 'nonce-<per request>';
connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'
```

plus `x-content-type-options: nosniff` (sent on every response). The one change from the old app's `script-src 'self'` is the nonce: Next.js streams the React Server Components payload in inline `<script>` tags, and those cannot run under `'self'` alone. Next reads the nonce from the request's CSP header (set in `proxy.ts`) and puts it on its own inline and external scripts, which is why the page renders per request (`connection()`). There is no `'unsafe-inline'` or `'unsafe-eval'` in production; `next dev` only adds `'unsafe-eval'` and inline styles for React's dev tooling and error overlay. Styles come from the bundled `app.css`, and the UI uses no inline `style` attributes.

The public price page keeps its previous policy (`default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'`). That page is self-contained HTML with one inline style block and one inline script that registers the service worker.

## Tests

`tests/http.test.ts` covers the price page (Tamil/English, freshness, MSP, 503) and the gateway (cookie flags, no token in JSON, CSRF header, internal 404, no upstream `set-cookie`). `npm run test:e2e` builds the app and drives it in Chromium through Playwright.
