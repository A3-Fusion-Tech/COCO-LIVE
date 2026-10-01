# ADR-007: SQLite persistence for the single-node pilot

**Status:** Accepted  
**Date:** 2026-10-01

## Context

All application state lived in process memory. A restart lost every price, user and deal, and the worker kept its own copy, so prices it ingested never reached the API. The price board cannot go live like that. The application services are synchronous and dependency-free; moving them to PostgreSQL ([ADR-001](./001-modular-monolith.md)) means making every service asynchronous and adding a driver, which is a larger change than the pilot needs.

## Decision

For the Pollachi-belt pilot, persist state with Node's built-in `node:sqlite` in one SQLite file (WAL mode) shared by the API and worker on one host.

- Each `Platform` collection is stored as JSON rows (`state(collection, key, json)`), see `packages/database`.
- Every API request and every worker step runs as a unit of work: `BEGIN IMMEDIATE`, reload if another process committed (`PRAGMA data_version`), run the synchronous operation, write only rows whose JSON changed, `COMMIT`.
- State changed by an operation that throws is still committed, preserving the in-memory semantics (for example, failed OTP attempts stay counted).
- Network calls (AGMARKNET pages) stay outside the write lock.

## Consequences

- Prices, sessions, listings and deals survive restarts, and the worker's ingestion appears on the API and price page.
- Writes are serialized across processes; this suits pilot traffic, not high write concurrency.
- One host only: the database file cannot be shared by several API instances on different machines.
- Each unit of work serializes every collection to find changes, which is linear in total state size. Fine for pilot volumes; it is a review trigger below.
- `node:sqlite` prints an experimental warning on Node 22.
- Fields whose value is `undefined` are omitted after a reload (JSON), which the code already treats the same way.

## Alternatives considered

- PostgreSQL now: rejected for the pilot because it requires rewriting all services as asynchronous; it remains the production target.
- Periodic snapshot file: rejected because it loses recent writes and does not let the worker and API share state.

## Review triggers

- More than one API instance is needed, or hosting moves to a platform without a persistent disk.
- p95 request latency rises because state serialization grows with data volume.
- The PostgreSQL migration in [implementation-status.md](../delivery/implementation-status.md) is scheduled.
