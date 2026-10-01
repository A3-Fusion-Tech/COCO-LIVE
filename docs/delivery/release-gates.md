# Release gates

## 1. General gate

- Product acceptance criteria approved.
- Security/privacy impact reviewed.
- Database migration tested and recoverable.
- Logs/metrics/alerts cover critical failures.
- Tamil and English visible copy reviewed.
- Runbook and support ownership assigned.
- Feature can be disabled or safely degraded.
- No unresolved critical/high defect.

## 2. Public price release

- Every number displays product, unit, location, stage, source time and confidence.
- Raw-to-aggregate reproducibility tested.
- Source freshness alert tested.
- Stale behavior and insufficient-evidence behavior demonstrated.
- Unit mismatch test suite passes.
- Contributor privacy reviewed.

## 3. Marketplace listing release

- Object-level authorization tests pass.
- Precise-location disclosure tested.
- Expiry and reconfirmation jobs monitored.
- Media scanning enforced.
- Contact reveal rate limits and audit active.
- Block/report and operator suspension functional.

## 4. Offer and deal release

- Concurrent acceptance test proves no oversell/duplicate deal.
- Offer/Deal Card immutability tests pass.
- Idempotency and retry tested.
- Amendment requires both parties.
- Cancellation/dispute rules visible before acceptance.
- Support team trained on event timeline.

## 5. Partner integration release

- Provider authentication/signature validation.
- Timeouts, retries, circuit breaker and idempotency.
- Reconciliation/exception queue.
- Data-sharing and retention reviewed.
- SLA and incident contact documented.
- Sandbox and failure simulation completed.

## 6. Production readiness review evidence

- Architecture/data-flow diagram.
- Threat-model update.
- Load-test result.
- Backup/restore result.
- Monitoring dashboard and alert routes.
- Rollout and rollback plan.
- Known limitations and user-facing wording.

