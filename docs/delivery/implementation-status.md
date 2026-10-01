# Implementation status

This document states precisely what is implemented, how it is verified, and what stands between this code and a production launch. It is the source of truth when other documents describe intended behavior.

## Layout

| Path | Contents |
|---|---|
| `packages/domain` | Money/quantity, catalog, price validation, anomaly signals, weighted-median aggregation and confidence, listing/offer/deal/dispute rules, matching, reputation |
| `packages/localization` | Tamil and English catalogs (parity-tested), INR/date formatting |
| `packages/contracts` | Problem responses, cursor pagination, request validation helpers |
| `packages/observability` | Redacting JSON logger, counters, correlation IDs |
| `packages/test-support` | Fake clock, world builder, sample terms |
| `apps/api` | `Platform` (application services) and the `/v1` HTTP server — see [endpoints](../api/endpoints.md) |
| `apps/worker` | AGMARKNET adapter (retry/jitter, defensive filtering, redaction) and idempotent ingest/maintenance jobs |
| `apps/web` | Server-rendered Tamil/English public price page, web manifest and offline-cache service worker |

## Feature coverage

### Release A — price board
- Canonical catalog (4 products, Pollachi-belt markets), unit/stage compatibility; incompatible buckets never aggregate.
- Raw-record store before parsing, hash-based idempotent replay, unmapped-value queue (never guessed), operator mapping resolution with reason.
- Source date is the observation time; re-ingestion never refreshes age.
- Contributor quotes scoped by approved claim; schema, semantic and anomaly validation; review queue; corrections supersede (raw/original preserved) and recompute.
- Weighted-median aggregation with minimum-evidence rule (≥3 observations, ≥2 independent organizations), per-organization collapse, bounded weights, calculation version, reproducibility from stored inputs, High/Medium/Low confidence.
- Public latest/history/evidence (contributor-anonymous)/MSP endpoints; stale and aging labels; MSP kept separate from market quotes.
- Alerts with consent, de-duplication, re-arming, pause/cancel; source-health statuses; audit log.

### Release B — assisted leads
- Phone-OTP identity (hashed, single-use, expiring, rate-limited, non-enumerating), sessions with rotation/revocation, organizations and roles, granular verification claims with conflict-of-interest and revocation effects.
- Sell lots (draft → review → active → reserved/sold/expired/withdrawn), product-specific validation, photo rule with audited exception, agent disclosure, material-revision invalidation, public views without precise location.
- Buy requirements (verified buyers), recurring templates producing dated instances.
- Deterministic explainable matching with reasons and operator-visible incompatibilities; block/report/suspend; gated, rate-limited, logged contact reveal.

### Release C — structured deals
- Offers and immutable counter-offer chains, expiry, quantity validation, atomic acceptance that reserves quantity and cannot oversell, idempotent retries.
- Frozen Deal Cards, two-party amendments, event timeline, pickup/delivery/acceptance/payment *confirmation* (no payment guarantee), cancellation, deemed acceptance only when agreed.
- Evidence with role-based access; disputes with windows, response period, operator resolution that cannot alter the card; outcome-derived reputation with minimum sample size.
- Operator queues, step-up authorization, per-capability access, audited privileged actions.

## Not implemented / simulated
- **Persistence:** all state is in memory (`Platform` maps). Acceptance is atomic because it is one synchronous unit; a database implementation must use row-locked transactions as described in [marketplace.md](../domain/marketplace.md). Migrations, PostGIS and the transactional outbox ([ADR 004](../decisions/004-transactional-outbox.md)) are therefore pending.
- **Providers:** OTP/SMS/WhatsApp use a console adapter; no media upload/scanning pipeline (evidence is metadata/notes); no object storage.
- **Release D** (inspection partners, logistics quotes, FPO aggregation and settlement export) and Phase 5 settlement are intentionally out of scope.
- **Web:** only the public price page and PWA shell exist. Authenticated farmer/buyer screens from [mobile-app-flow.md](../product/mobile-app-flow.md) and the operations console UI are not built; the API supports them.
- **Operations:** deployment, monitoring dashboards, secret scanning and the exit gates in [release-gates.md](./release-gates.md) (e.g. four weeks of reliable operations, liquidity metrics) cannot be satisfied by code alone.
- Tamil copy requires human review before launch.

## Verification
`npm test` runs 40 tests: domain invariants (order independence, unit incompatibility, duplication, staleness), the price pipeline, marketplace/deal/dispute flows, authorization and step-up, idempotency, rate limits, HTTP contracts, the worker adapter and the Tamil/English web page. `npm run typecheck` uses strict TypeScript (`erasableSyntaxOnly`, `noUncheckedIndexedAccess`).
