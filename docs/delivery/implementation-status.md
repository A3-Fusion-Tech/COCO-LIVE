# Implementation status

This document states precisely what is implemented, how it is verified, and what stands between this code and a production launch. It is the source of truth when other documents describe intended behavior.

## Layout

| Path | Contents |
|---|---|
| `packages/domain` | Money/quantity, catalog, price validation, anomaly signals, weighted-median aggregation and confidence, listing/offer/deal/dispute rules, matching, reputation |
| `packages/localization` | Tamil and English catalogs (parity-tested), INR/date formatting, notification templates |
| `packages/contracts` | Problem responses, cursor pagination, request validation helpers |
| `packages/database` | PostgreSQL migrations, per-request unit of work (`Tx`) over `PgStore` (row locks, retries) and `MemoryStore`, CLI ([ADR-008](../decisions/008-document-store-unit-of-work.md), [ADR-010](../decisions/010-stateless-services-row-locked-units-of-work.md)) |
| `packages/observability` | Redacting JSON logger, counters, correlation IDs |
| `packages/test-support` | Fake clock, world builder (call services as a participant: `w.as(login).lots.create(…)`), sample terms |
| `apps/api` | Stateless services per module (`src/modules/*`: identity, prices, marketplace, deals, fulfilment, media, operations), wired in `src/app.ts`; one NestJS feature module and controller each, sharing the request pipeline in `src/http` — see [endpoints](../api/endpoints.md) |
| `apps/worker` | AGMARKNET adapter, ingest/maintenance/housekeeping jobs and outbox delivery, running the API services directly against Postgres |
| `apps/web` | Next.js App Router: ISR price board per language (`/ta`, `/en`); public market and sign-in; signed-in route group for every role with server-side data fetching and Server Actions; typed API client; same-origin `/v1` proxy keeping the session in an HttpOnly cookie; nonce-based CSP — see [apps/web](../../apps/web/README.md) |
| `apps/mobile` | Flutter Android app (Tamil-first, English): public price board with evidence and MSP, phone OTP sign-in with the bearer token in the platform keystore, price alerts with consent, market, sell lots, buy requirements, offer threads and deal cards — see [apps/mobile](../../apps/mobile/README.md) |

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

### Mobile app (Flutter)
- `apps/mobile` uses only the existing `/v1` contracts ([ADR-009](../decisions/009-nextjs-nestjs-flutter.md)): price board (low/reference/high, freshness and confidence as text, not-an-offer disclaimer, evidence, MSP) without sign-in; OTP sign-in, sign-out and sign-out-everywhere; alerts with explicit consent; market browsing with offers; sell-lot creation, photo upload, publish and withdraw; one-off and recurring buy requirements with matches; negotiation threads (accept/counter/reject/withdraw); deal list and deal card with milestones, role-based actions and amendment responses.
- Every mutation sends an `Idempotency-Key`, every request sends `Accept-Language` and `?lang=`, errors render the problem `message`; money is formatted from paise as INR.
- Verified by `flutter analyze` and `flutter test` (API client against a mock HTTP client, formatting/catalog parity, widget tests for the price board, sign-in and alert consent) in the CI `mobile` job, plus an opt-in run of the whole flow against a live development API (`test/live_api_test.dart`). Not yet built into an APK in CI or tested on low-end devices; organisations, verification claims, inspection, transport, disputes, settlements and partner/operator work remain web-only.

### Operations and persistence
- PostgreSQL schema with generated columns, constraints, append-only/immutability triggers, checksummed migrations, GIN-indexed containment queries, one row-locked transaction per request with automatic retry on conflicts; any number of API and worker processes.
- Transactional outbox with leases, exponential backoff, dead-lettering and an operator risk item; retention purge for OTPs, rate windows, old sessions, idempotency keys and sent notifications.
- Docker Compose (PostGIS image), CI with a Postgres service, seed script for synthetic local actors.

## Verification
`npm test` runs the unit, HTTP and Postgres suites (the Postgres-backed tests need `DATABASE_URL`): domain invariants, the price pipeline, marketplace/deal/dispute/Release D flows, authorization and step-up, idempotency, rate limits, HTTP contracts, worker adapter and outbox, durability across processes, rollback, concurrency across processes (exactly one winner among simultaneous acceptances, idempotent retries execute once, one outbox lease per message), and database-level constraint and trigger checks. `npm run test:e2e` builds the Next.js app and drives it in a real browser (CSP and routing headers, seller → buyer → completed deal, Tamil switch, CSRF and cookie checks, operator step-up and queue decision, console-error check; needs Playwright/Chromium). `npm run typecheck` uses strict TypeScript (`erasableSyntaxOnly`, `noUncheckedIndexedAccess`).

## Known limits and what remains before launch
- **Query paths.** State lives only in PostgreSQL and every process is stateless ([ADR-010](../decisions/010-stateless-services-row-locked-units-of-work.md)); a few periodic jobs scan a whole state set (e.g. eligible observations for aggregation) and are the first candidates for dedicated indexes. PostGIS is available in the compose image but geo queries still use in-process haversine.
- **Providers.** SMS/WhatsApp/push are adapters with a console implementation; a real, DLT-registered SMS provider and WhatsApp template approval must be added. Object storage is local disk (S3-compatible adapter pending); image re-encoding/resizing and antivirus scanning are not implemented — the scan step is signature/content sniffing only.
- **Web.** The Next.js app is a reference UI covering every role (a direct port of the earlier vanilla-JS PWA). It has had a browser smoke/e2e pass but no accessibility audit, no on-device low-end testing, and the Tamil copy is a first draft requiring human review. Offline support caches the shell and public prices only; offline drafts are not implemented.
- **Operations.** No deployment, monitoring dashboards, backups/restore drill, secret scanning or dependency review yet; the release gates in [release-gates.md](./release-gates.md) (e.g. four weeks of reliable operation, liquidity metrics, legal review of the operating model) cannot be satisfied by code alone.
- **Payments** remain confirmations only; managed settlement (Phase 5) is intentionally out of scope.
