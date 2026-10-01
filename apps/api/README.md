# API application

The API workspace owns synchronous application commands and queries. It will be a modular monolith whose boundaries are documented in [ARCHITECTURE.md](../../ARCHITECTURE.md).

The API must not perform slow source polling or notification fan-out inside HTTP requests. Those operations belong to the worker workspace.


## Running

```text
npm run dev        # http://localhost:4000, see docs/api/endpoints.md
```

State is in memory (see [implementation status](../../docs/delivery/implementation-status.md)). `Platform` in `src/platform.ts` holds the application services; `src/server.ts` maps them to `/v1` routes with validation, idempotency, problem responses and rate limiting.
