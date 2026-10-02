# ADR-008: PostgreSQL document tables with a per-request unit of work

**Status:** Accepted  
**Date:** 2026-10-01

## Context

This supersedes [ADR-007](./007-sqlite-pilot-persistence.md) (SQLite shared by API and worker): the worker now reaches state only through the API's internal endpoints, so a single PostgreSQL writer replaces the shared file.


The application services (`apps/api/src/platform.ts`, `fulfilment.ts`) were written as framework-independent domain logic over aggregates (users, lots, offers, deals, settlements…). The business needs durable storage, real transactions, and database-enforced integrity (no oversold lots, append-only audit and Deal Card history, balanced settlements) without rewriting every rule as SQL.

## Decision

- Each aggregate is stored as a **JSONB document** keyed by its opaque id (`key text primary key, doc jsonb`).
- Columns used for lookups, uniqueness and integrity are **generated from the document** (`generated always as (doc->>'status') stored`) so they cannot drift. Constraints (`CHECK`, partial unique indexes) and **triggers** enforce invariants independently of application code:
  - `quantity_reserved <= quantity_total` on sell lots; one `ACTIVE` offer per thread; one accepted transport quote per request; one settlement per deal; one dispute per deal.
  - Append-only: audit log, notifications, reputation, contact reveals, reports, raw source records, aggregate-lot member mappings.
  - Immutable after creation: offer terms, observation prices, inspection results, approved settlements, resolved disputes; Deal Card revisions and events can only grow.
  - Settlement member lines must sum exactly to the totals.
- The API process loads the database into memory at start-up and serves each request as **one serialised unit of work** (`PgStore.withTransaction`): handlers mutate aggregates, then only entities whose canonical JSON changed are written in a single SQL transaction. If a handler or the commit fails, touched entities are restored from the last committed state, so memory never diverges from the database. Failed OTP attempts are committed deliberately (`persistState`), so brute-force counters survive errors.
- A session-level **advisory lock** ensures exactly one writer process per database/schema.
- Notifications are inserted into the `outbox` table in the same transaction as the state change (ADR-004); the worker claims them under a lease, delivers through provider adapters, and acknowledges with retry/backoff and dead-lettering.

## Consequences

- Acceptance of an offer is genuinely atomic and serialised; concurrent acceptances produce exactly one winner (tested against Postgres).
- Restart-safe: sessions, idempotency keys, OTP attempt counters, deals and audit history all survive restarts.
- **Single writer:** the API cannot be scaled horizontally for writes. Reads could be served from replicas later, but any second writer needs the aggregates moved to query-level repositories (row locks) first.
- Memory use grows with data volume; this is acceptable for the pilot (Pollachi belt) and is the first thing to revisit.
- Document tables trade ad-hoc relational reporting for speed of delivery; generated columns and indexes cover the access paths used today.

## Alternatives considered

- Fully normalised relational model with a repository per aggregate: the long-term target, rejected for the pilot because it would rewrite all domain behaviour and its tests.
- Event sourcing: more machinery than the audit/immutability requirements need.
- Optimistic multi-writer with version checks: needs repositories that read-modify-write per request.

## Review triggers

- A second API instance is required for availability or load.
- The working set no longer fits comfortably in memory, or request latency approaches the p95 target.
- Reporting needs relational queries the generated columns cannot serve.
