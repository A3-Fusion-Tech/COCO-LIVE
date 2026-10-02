# API application

The API workspace owns synchronous application commands and queries. It will be a modular monolith whose boundaries are documented in [ARCHITECTURE.md](../../ARCHITECTURE.md).

The API must not perform slow source polling or notification fan-out inside HTTP requests. Those operations belong to the worker workspace.


## Running

```text
npm run dev        # http://localhost:4000, see docs/api/endpoints.md
```

The API is a NestJS application ([ADR-009](../../docs/decisions/009-nextjs-nestjs-flutter.md)), run with `tsx`. `Platform` in `src/platform.ts` holds the application services. `src/server.ts` builds the Nest app; the controllers in `src/http/controllers` map the services to `/v1` routes, and `src/http/pipeline.ts` holds the shared request pipeline (validation, unit of work, service token, sessions, idempotency, problem responses and rate limiting). Route options are decorators from `src/http/route-kit.ts`: `@Public()`, `@Internal()`, `@Idempotent()`, `@Shape(...)`.

## Persistence

With `DATABASE_URL` set the API loads state from PostgreSQL, serves each request as one serialised unit of work and commits changed entities in a single transaction ([ADR-008](../../docs/decisions/008-document-store-unit-of-work.md)). Release D services live in `src/fulfilment.ts`; internal worker endpoints (`/v1/internal/*`) require `INTERNAL_API_TOKEN`.
