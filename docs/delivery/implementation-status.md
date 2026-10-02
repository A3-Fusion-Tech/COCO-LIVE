# Implementation status

This document states precisely what is implemented, how it is verified, and what stands between this code and a production launch. It is the source of truth when other documents describe intended behavior.

## Layout

| Path | Contents |
|---|---|
| `packages/domain` | Money/quantity, catalog, price validation, anomaly signals, weighted-median aggregation and confidence, listing/offer/deal/dispute rules, matching, reputation |
| `packages/localization` | Tamil and English catalogs (parity-tested), INR/date formatting, notification templates |
| `packages/contracts` | Problem responses, cursor pagination, request validation helpers |
| `packages/database` | PostgreSQL migrations, `PgStore` unit of work, writer lock, CLI ([ADR-008](../decisions/008-document-store-unit-of-work.md)) |
| `packages/observability` | Redacting JSON logger, counters, correlation IDs |
| `packages/test-support` | Fake clock, world builder, sample terms |
| `apps/api` | `Platform` (price/identity/marketplace/deal services), `Fulfilment` (Release D), and the `/v1` HTTP server — see [endpoints](../api/endpoints.md) |
| `apps/worker` | AGMARKNET adapter, ingest/maintenance jobs, outbox delivery with provider adapters |
| `apps/web` | SSR public price page; installable PWA (`/app/`) for farmers, buyers, FPOs, partners and operators; same-origin gateway keeping the session in an HttpOnly cookie |

## Feature coverage

### Release A — price board
- Canonical catalog (4 products, Pollachi-belt markets), unit/stage compatibility; incompatible buckets never aggregate.
- Raw-record store before parsing, hash-based idempotent replay, unmapped-value queue (never guessed), operator mapping resolution with reason.
- Source date is the observation time; re-ingestion never refreshes age.
- Contributor quotes scoped by approved claim; schema, semantic and anomaly validation; review queue; corrections supersede (raw/original preserved) and recompute.
- Weighted-median aggregation with minimum-evidence rule (≥3 observations, ≥2 independent organizations), per-organization collapse, bounded weights, calculation version, reproducibility from stored inputs, High/Medium/Low confidence.
- Public latest/history/evidence (contributor-anonymous)/MSP endpoints; stale and aging labels; MSP kept separate from market quotes.
- Alerts with consent, de-duplication, re-arming, pause/cancel; delivery through the outbox; source-health statuses; audit log.

### Release B — assisted leads
- Phone-OTP identity (hashed, single-use, expiring, rate-limited, non-enumerating; failed attempts persist), sessions with rotation/revocation, organizations and roles, granular verification claims with conflict-of-interest and revocation effects.
- Sell lots (draft → review → active → reserved/sold/expired/withdrawn), product-specific validation, photo rule with audited exception, agent disclosure, material-revision invalidation, public views without precise location.
- Buy requirements (verified buyers), recurring templates producing dated instances.
- Deterministic explainable matching with reasons and operator-visible incompatibilities; block/report/suspend; gated, rate-limited, logged contact reveal.
- Media: upload intents, signed direct upload, content sniffing/active-content rejection, nothing served before approval, approved photos attach to lots; abandoned slots purged.

### Release C — structured deals
- Offers and immutable counter-offer chains, expiry, quantity validation, atomic acceptance that reserves quantity and cannot oversell, idempotent retries.
- Frozen Deal Cards, two-party amendments, event timeline, pickup/delivery/acceptance/payment *confirmation* (no payment guarantee), cancellation, deemed acceptance only when agreed.
- Evidence with role-based access; disputes with windows, response period, operator resolution that cannot alter the card; outcome-derived reputation with minimum sample size.
- Operator queues, step-up authorization, per-capability access, audited privileged actions.

### Release D — partner fulfilment and FPO depth
- Inspection and logistics partner onboarding (operator-approved); inspection workflow that gates the deal (`INSPECTION_PENDING`), buyer decision on FAIL/CONDITIONAL, immutable results, measurable SLAs.
- Transport requests, competing partner quotes, single booking, ordered status updates, vehicle details visible only to parties and the booked partner, quote/delivery SLAs.
- FPO member lots with review, aggregate lots preserving member contribution mapping, compatibility errors, settlement drafts apportioned exactly (largest remainder) with deductions, second-manager approval, immutable approved settlements and injection-safe CSV export.

### Operations and persistence
- PostgreSQL schema with generated columns, constraints, append-only/immutability triggers, checksummed migrations, single-writer advisory lock, per-request transactions with in-memory rollback.
- Transactional outbox with leases, exponential backoff, dead-lettering and an operator risk item; retention purge for OTPs, rate windows, old sessions, idempotency keys and sent notifications.
- Docker Compose (PostGIS image), CI with a Postgres service, seed script for synthetic local actors.

## Verification
`npm test` runs 65 tests (the 12 Postgres-backed tests need `DATABASE_URL`): domain invariants, the price pipeline, marketplace/deal/dispute/Release D flows, authorization and step-up, idempotency, rate limits, HTTP contracts, worker adapter and outbox, restart durability, rollback, concurrency (exactly one winner among simultaneous acceptances), and database-level constraint and trigger checks. `npm run test:e2e` drives the PWA in a real browser (seller → buyer → completed deal, Tamil switch, CSRF and cookie checks, operator step-up and queue decision, console-error check; needs Playwright/Chromium). `npm run typecheck` uses strict TypeScript (`erasableSyntaxOnly`, `noUncheckedIndexedAccess`).

## Known limits and what remains before launch
- **Single writer.** Aggregates live in the API process and are persisted per request ([ADR-008](../decisions/008-document-store-unit-of-work.md)); horizontal write scaling needs query-level repositories. PostGIS is available in the compose image but geo queries still use in-process haversine.
- **Providers.** SMS/WhatsApp/push are adapters with a console implementation; a real, DLT-registered SMS provider and WhatsApp template approval must be added. Object storage is local disk (S3-compatible adapter pending); image re-encoding/resizing and antivirus scanning are not implemented — the scan step is signature/content sniffing only.
- **Web.** The PWA is a vanilla-JS reference UI covering every role. It has had a browser smoke/e2e pass but no accessibility audit, no on-device low-end testing, and the Tamil copy is a first draft requiring human review. Offline support caches the shell and public prices only; offline drafts are not implemented.
- **Operations.** No deployment, monitoring dashboards, backups/restore drill, secret scanning or dependency review yet; the release gates in [release-gates.md](./release-gates.md) (e.g. four weeks of reliable operation, liquidity metrics, legal review of the operating model) cannot be satisfied by code alone.
- **Payments** remain confirmations only; managed settlement (Phase 5) is intentionally out of scope.
