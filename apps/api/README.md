# API application

The API workspace owns synchronous application commands and queries. It will be a modular monolith whose boundaries are documented in [ARCHITECTURE.md](../../ARCHITECTURE.md).

The API must not perform slow source polling or notification fan-out inside HTTP requests. Those operations belong to the worker workspace.


## Running

```text
npm run dev        # http://localhost:4000, see docs/api/endpoints.md
```

The API is a NestJS application ([ADR-009](../../docs/decisions/009-nextjs-nestjs-flutter.md)), run with `tsx`.

```text
src/
  app.ts            composition root: config, every service wired once, LiveCoco.run(fn) = one unit of work
  server.ts         Nest bootstrap: global CoreModule (services by class token) + one module per feature
  core/             cross-cutting services: Scope, audit log, work queues, outbox notifier, idempotency
  http/             shared request pipeline (validation, unit of work, sessions, idempotency, problem responses,
                    rate limiting) and route decorators: @Public(), @Idempotent(), @Shape(...), @Binary()
  modules/
    identity/       OTP sign-in, sessions, step-up, capabilities, organisations, verification claims, evidence
    prices/         ingestion, normalisation, anomaly review, quotes, aggregation, price views; alerts
    marketplace/    sell lots, buy requirements and matching, offers and threads, participants/reputation
    deals/          deal cards, amendments, milestones, evidence, disputes
    fulfilment/     inspection and logistics partners; FPO aggregation and settlements
    media/          signed uploads, content scanning, authorised downloads
    operations/     trust & safety, operator console; maintenance jobs run by the worker
```

Services are stateless. Every method takes a `Scope` (the unit of work, clock, correlation id and actor) as its first argument; controllers are thin adapters from routes to service calls.

## Persistence

With `DATABASE_URL` set, each request is one Postgres transaction that locks the rows it reads (GET requests take no locks) and is retried automatically on conflicts. Any number of API and worker processes can share the database ([ADR-010](../../docs/decisions/010-stateless-services-row-locked-units-of-work.md)). Without it the API uses the in-memory store (development only).
