# Worker application

The worker workspace owns scheduled and asynchronous processing:

- Price-source retrieval and normalization.
- Aggregate refresh.
- Listing and offer expiry.
- Match generation.
- Notifications and retries.
- Media scanning and retention jobs.

Every job must be idempotent and observable. See [the price runbook](../../docs/operations/price-source-runbook.md).


## Running

```text
DATA_GOV_IN_API_KEY=... npm run dev:worker
```

`src/agmarknet.ts` is the data.gov.in adapter; `src/jobs.ts` contains the idempotent ingest and maintenance (expiry, aggregation, alerts) jobs.

Jobs: AGMARKNET ingest, maintenance tick (expiry, aggregates, alerts, media scan, retention purge) and outbox delivery through provider adapters (`SMS_PROVIDER=console` for development). The worker talks to the API only through `/v1/internal/*` with `INTERNAL_API_TOKEN`.
