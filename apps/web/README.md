# Web application

The web workspace will provide:

- Public, indexable price pages.
- Tamil-first authenticated farmer and buyer workflows.
- Installable low-bandwidth PWA behavior.
- A protected operations console during the MVP.

Implementation must follow [the product requirements](../../docs/product/requirements.md), [API conventions](../../docs/api/conventions.md) and [privacy controls](../../docs/security/privacy.md).


## Running

```text
API_BASE_URL=http://localhost:4000 npm run dev:web
```

Public Tamil/English price page (`/?lang=ta|en`), web manifest and offline-cache service worker.

Also implemented: the installable PWA at `/app/` (prices, market, sell, buy, offers and deals, FPO aggregation and settlement, partner workspace, operations console) in Tamil and English. The web server is a same-origin gateway: the API session token lives in an HttpOnly, SameSite=Strict cookie, mutations require `x-requested-with`, and a strict CSP (no inline script/style) applies to the app. Browser test: `npm run test:e2e`.
