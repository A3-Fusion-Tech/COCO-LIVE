# Worker application

The worker workspace owns scheduled and asynchronous processing:

- Price-source retrieval and normalization.
- Aggregate refresh.
- Listing and offer expiry.
- Match generation.
- Notifications and retries.
- Media scanning and retention jobs.

Every job must be idempotent and observable. See [the price runbook](../../docs/operations/price-source-runbook.md).

