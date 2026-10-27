# Web application

Next.js (App Router, React, TypeScript) web tier ([ADR-009](../../docs/decisions/009-nextjs-nestjs-flutter.md)). It provides:

- the public Tamil/English price board;
- the public market and sign-in;
- signed-in workflows for every role: sell, buy, offers and deals, alerts, FPO aggregation and settlement, the partner workspace, and the operations console with OTP step-up.

Implementation must follow [the product requirements](../../docs/product/requirements.md), [API conventions](../../docs/api/conventions.md) and [privacy controls](../../docs/security/privacy.md).

## Running

```text
API_BASE_URL=http://localhost:4000 npm run dev:web                            # next dev on :3000
npm run build:web && API_BASE_URL=http://localhost:4000 npm run start:web     # next start (no custom server)
```

These settings are read per request and are never inlined at build time:

| Variable | Default | Meaning |
| --- | --- | --- |
| `API_BASE_URL` | `http://localhost:4000` | Where the API lives. |
| `COOKIE_SECURE` | on when `NODE_ENV=production` | `1`/`0`: mark the session cookie `Secure`. |
| `TRUST_PROXY` | off | `1` only when a reverse proxy in front of the web tier appends the real client address to `x-forwarded-for`. |

When `TRUST_PROXY` is set, the last `x-forwarded-for` entry is forwarded to the API for rate limiting. Otherwise no client address is forwarded, so a client can never choose the address it is rate-limited on.

## Layout

| Path | What |
| --- | --- |
| `app/(board)/[lang]` | Public price board at `/ta` and `/en`: a server component regenerated every minute (ISR), identical for everyone, with its own error and 404 states. `/` redirects to the visitor's language. |
| `app/(site)/(public)` | Market and lot pages, price evidence and sign-in. |
| `app/(site)/(app)` | Signed-in sections: `sell`, `buy`, `deals`, `alerts`, `org`, `partner`, `me`, `ops`. The group's layout validates the session. Pages fetch on the server with the session cookie. Mutations are Server Actions (`actions.ts` next to each page), and client components exist only where interaction needs them (forms, photo upload). |
| `app/_components`, `app/_lib` | Shared chrome, form and UI components, and the server-side helpers that build an API client for the current request. |
| `app/v1/[...path]` | Same-origin `/v1` proxy for browser code (signed photo uploads, the service worker's public reads). It attaches the bearer token from the cookie, requires `x-requested-with` on mutations except signed uploads, returns 404 for `/v1/internal/*`, and strips upstream `set-cookie`. |
| `app/manifest.ts`, `public/sw.js`, `app/healthz` | PWA manifest, the offline service worker (never caches signed-in pages) and the health check. |
| `lib/api` | Typed API client (`client.ts`), resource types (`types.ts`) and problem+json handling (`errors.ts`). |
| `lib/gateway` | Runtime config, the session cookie (`lc_session`: `HttpOnly; SameSite=Strict`, `Secure` in production) and the `/v1` proxy. The session token never reaches page JavaScript. |
| `lib/i18n` | Locale resolution (`?lang=`, then the `lc_lang` cookie, then `Accept-Language`; Tamil by default) and the message catalog. |
| `lib/security/csp.ts`, `proxy.ts` | Per-request CSP nonce for app pages and a static policy for the board. `proxy.ts` also does the language redirect and remembers `?lang=`, and sends signed-out visitors of app sections to `/login`. |

## Security

- App pages are sent with `script-src 'self' 'nonce-<per request>'`, `object-src 'none'`, `frame-ancestors 'none'` and `base-uri 'none'`. There is no `'unsafe-inline'` or `'unsafe-eval'` in production.
- Server Actions reject requests from a foreign `Origin`.
- `x-content-type-options: nosniff` is sent on every response.

## Tests

- `tests/web.test.ts` covers, without a Next build:
  - the gateway and proxy: cookie flags, CSRF, internal 404s, IP forwarding;
  - locale resolution, the CSP, the API client, price-card formatting, form parsing, and the manifest and service worker.
- `npm run test:e2e` builds the app, starts `next start` against an in-memory API and drives the whole seller → buyer → completed-deal flow, the language switch, the security checks and the operator console in Chromium through Playwright.
