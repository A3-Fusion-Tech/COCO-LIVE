# ADR-010: Stateless services over row-locked units of work

**Status:** Accepted  
**Date:** 2026-10-27  
**Supersedes:** the in-memory, single-writer part of [ADR-008](./008-document-store-unit-of-work.md). The document tables, generated columns, constraints and triggers from ADR-008 are kept unchanged.

## Context

Under ADR-008 the API loaded the whole database into one `Platform` object at start-up. Every request, including reads, was queued behind a single in-process mutex, and an advisory lock allowed only one writer process. As a result:

- memory use and start-up time grew with all data ever stored, including the audit log;
- the API could not run more than one process, so there was no horizontal scaling and no zero-downtime deploys;
- the worker could not touch the database, so it called `/v1/internal/*` HTTP endpoints on the API;
- every collection lived on one god-object (`platform.ts`, about 1,200 lines, plus `fulfilment.ts`), with no module boundaries despite [ADR-001](./001-modular-monolith.md);
- controllers reached into the in-memory tables directly, so query logic was spread across the HTTP layer.

## Decision

- **Storage is the only state.** Services are stateless classes, one per module (identity, prices, alerts, lots, requirements, offers, deals, partners, FPO, media, operations, maintenance). They are wired once in a composition root (`apps/api/src/app.ts`). Each call receives a `Scope`, which holds the unit of work, the clock, the correlation id and the authenticated actor.
- **One unit of work per request or job** (`packages/database/src/store.ts`):
  - Reads load only the rows they need, using primary-key gets or `doc @> match` containment queries backed by GIN indexes.
  - An identity map gives read-your-writes within the unit.
  - Writes are explicit (`put`, `delete`, `append`) and are flushed once at commit, in one Postgres transaction.
- **Row locks instead of a global mutex.** In a write unit of work every row read is locked (`SELECT … FOR UPDATE`), so two requests that touch the same lot, offer or deal serialise only on those rows; everything else runs in parallel. Read-only (GET) requests take no locks.
- **Conflicts are retried.** On a deadlock, serialisation failure or unique violation (`40P01`, `40001`, `23505`), the unit of work is re-run from scratch. For a key that was read and found absent, the write is a strict insert, so two simultaneous first attempts of one idempotent request collapse into one execution. A key written without being read first (a natural key such as a phone number) is upserted.
- **`persistState` is kept.** A failed OTP attempt still commits its attempt counter before the error is returned.
- **Any number of API and worker processes.** The writer advisory lock is removed. The worker runs the same services directly against Postgres, and the `/v1/internal/*` endpoints and `INTERNAL_API_TOKEN` are gone. Outbox claims are leases written under row locks, so two workers never deliver the same message.
- **`MemoryStore`** has the same interface and isolation (units of work run one at a time). It is used by unit tests and by database-less local development; production refuses to start without `DATABASE_URL`.
- **NestJS feature modules.** Each module has its own Nest module and a thin controller. A global core module provides the service instances under their class tokens.

## Consequences

- The API and worker scale horizontally. Memory use is bounded by the request, not by the size of the database.
- Concurrency guarantees that used to rely on a single writer are now tested across processes against Postgres: exactly one of four concurrent acceptances wins and nothing is oversold, a retried idempotent request executes once, and an outbox message is leased to only one worker.
- Migration `004_unit_of_work.sql` adds a stable insertion order (`ord`) and GIN indexes to every document table, takes log `idx` values from sequences, and adds a unique key that de-duplicates notifications.
- Services that scan a whole state set do so with containment queries on that state, for example all `ACTIVE` lots in the expiry tick, or `ELIGIBLE`/`PUBLISHED` observations for aggregation. These are the places to add generated columns or range indexes if volumes grow.
- Unit tests call services as a participant through `@livecoco/test-support` (`w.as(login).lots.create(...)`), and each call is its own unit of work, as it is over HTTP.

## Alternatives considered

- **Keep the in-memory model and add replicas:** this does not remove the single-writer bottleneck or the memory growth.
- **Fully normalised tables with hand-written SQL repositories:** these remain an option for individual hot paths, but would have rewritten every rule and integrity trigger at once.
- **SERIALIZABLE isolation for everything:** simpler to reason about, but it causes more retries under load. Explicit row locks plus unique constraints cover the invariants the business needs.

## Review triggers

- Containment scans show up in p95 latency (add generated columns or indexes, or a dedicated query).
- Reporting needs relational joins the document tables cannot serve.
