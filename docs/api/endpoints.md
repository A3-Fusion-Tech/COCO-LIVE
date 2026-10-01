# Implemented HTTP endpoints

Generated from `apps/api/src/server.ts` (all under `/v1`). Conventions are in [conventions.md](./conventions.md); resource shapes in [resources.md](./resources.md).

Legend: **Public** needs no session. **Idem** requires an `Idempotency-Key` header. Authenticated endpoints use `Authorization: Bearer <session token>`; operator endpoints additionally need an operator capability and a recent step-up (`POST /v1/auth/step-up`).

| Method | Path | Access | Idem |
|---|---|---|---|
| GET | `/v1/prices/latest` | Public |  |
| GET | `/v1/prices/evidence` | Public |  |
| GET | `/v1/prices/history` | Public |  |
| GET | `/v1/prices/msp` | Public |  |
| GET | `/v1/sell-lots` | Public |  |
| POST | `/v1/auth/otp/request` | Public |  |
| POST | `/v1/auth/otp/verify` | Public |  |
| POST | `/v1/auth/step-up` | Session |  |
| GET | `/v1/me` | Session |  |
| PATCH | `/v1/me` | Session |  |
| GET | `/v1/me/sessions` | Session |  |
| POST | `/v1/me/sessions/revoke-all` | Session |  |
| POST | `/v1/organizations` | Session |  |
| POST | `/v1/organizations/:id/members` | Session |  |
| POST | `/v1/claims` | Session |  |
| GET | `/v1/me/claims` | Session |  |
| POST | `/v1/alerts` | Session | yes |
| GET | `/v1/alerts` | Session |  |
| PATCH | `/v1/alerts/:id` | Session |  |
| POST | `/v1/contributor/quotes` | Session |  |
| POST | `/v1/contributor/observations/:id/correction` | Session |  |
| POST | `/v1/sell-lots` | Session |  |
| GET | `/v1/me/sell-lots` | Session |  |
| GET | `/v1/sell-lots/:id` | Session |  |
| PATCH | `/v1/sell-lots/:id` | Session |  |
| POST | `/v1/sell-lots/:id/photos` | Session |  |
| POST | `/v1/sell-lots/:id/activate` | Session | yes |
| POST | `/v1/sell-lots/:id/withdraw` | Session | yes |
| GET | `/v1/sell-lots/:id/matches` | Session |  |
| POST | `/v1/buy-requirements` | Session | yes |
| POST | `/v1/buy-requirements/recurring` | Session |  |
| GET | `/v1/me/buy-requirements` | Session |  |
| GET | `/v1/buy-requirements/:id/matches` | Session |  |
| POST | `/v1/buy-requirements/:id/close` | Session |  |
| POST | `/v1/offers` | Session |  |
| GET | `/v1/offers` | Session |  |
| POST | `/v1/offers/:id/counter` | Session | yes |
| POST | `/v1/offers/:id/accept` | Session | yes |
| POST | `/v1/offers/:id/reject` | Session |  |
| POST | `/v1/offers/:id/withdraw` | Session |  |
| POST | `/v1/threads/:id/contact-reveal` | Session | yes |
| POST | `/v1/users/:id/block` | Session |  |
| POST | `/v1/users/:id/report` | Session |  |
| GET | `/v1/users/:id/reputation` | Public |  |
| GET | `/v1/deals` | Session |  |
| GET | `/v1/deals/:id` | Session |  |
| POST | `/v1/deals/:id/amendments` | Session |  |
| POST | `/v1/deals/:id/amendments/respond` | Session |  |
| POST | `/v1/deals/:id/pickup` | Session | yes |
| POST | `/v1/deals/:id/delivery` | Session | yes |
| POST | `/v1/deals/:id/accept` | Session | yes |
| POST | `/v1/deals/:id/payment` | Session |  |
| POST | `/v1/deals/:id/complete` | Session | yes |
| POST | `/v1/deals/:id/cancel` | Session |  |
| POST | `/v1/deals/:id/evidence` | Session |  |
| GET | `/v1/deals/:id/evidence` | Session |  |
| POST | `/v1/deals/:id/disputes` | Session |  |
| GET | `/v1/disputes/:id` | Session |  |
| POST | `/v1/disputes/:id/response` | Session |  |
| GET | `/v1/ops/queues` | Operator + step-up |  |
| GET | `/v1/ops/source-health` | Operator + step-up |  |
| GET | `/v1/ops/audit` | Operator + step-up |  |
| POST | `/v1/ops/observations/:id/review` | Operator + step-up |  |
| POST | `/v1/ops/mapping/:id/resolve` | Operator + step-up |  |
| POST | `/v1/ops/prices/refresh` | Operator + step-up |  |
| POST | `/v1/ops/claims/:id/decision` | Operator + step-up |  |
| POST | `/v1/ops/listings/:id/review` | Operator + step-up |  |
| POST | `/v1/ops/listings/:id/photo-exception` | Operator + step-up |  |
| GET | `/v1/ops/requirements/:id/matches` | Operator + step-up |  |
| POST | `/v1/ops/disputes/:id/resolve` | Operator + step-up |  |
| POST | `/v1/ops/users/:id/suspend` | Operator + step-up |  |

Also: `GET /healthz`, `GET /readyz` (unversioned).

Errors use the problem format from the conventions document with `code`, `messageKey` and a localized `message` (`?lang=ta|en` or `Accept-Language`).
