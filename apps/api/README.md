# API application

The API workspace owns synchronous application commands and queries. It will be a modular monolith whose boundaries are documented in [ARCHITECTURE.md](../../ARCHITECTURE.md).

The API must not perform slow source polling or notification fan-out inside HTTP requests. Those operations belong to the worker workspace.


## Running

```text
npm run dev        # http://localhost:4000, see docs/api/endpoints.md
```

State is in memory (see [implementation status](../../docs/delivery/implementation-status.md)). `Platform` in `src/platform.ts` holds the application services; `src/server.ts` maps them to `/v1` routes with validation, idempotency, problem responses and rate limiting.

## Persistence

With `DATABASE_URL` set the API loads state from PostgreSQL, serves each request as one serialised unit of work and commits changed entities in a single transaction ([ADR-007](../../docs/decisions/007-document-store-unit-of-work.md)). Release D services live in `src/fulfilment.ts`; internal worker endpoints (`/v1/internal/*`) require `INTERNAL_API_TOKEN`.
