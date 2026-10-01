# Testing strategy

## 1. Risk-based approach

The highest-risk behavior is not visual rendering. It is price correctness, authorization, quantity allocation, immutable agreements and privacy. Test investment follows that risk.

## 2. Unit tests

Use deterministic, framework-independent tests for:

- Money arithmetic and rounding.
- Quantity conversion compatibility.
- Price-bucket compatibility.
- Freshness decay and confidence policy.
- Listing, requirement, offer, deal and verification transitions.
- Grade matching.
- Capability/authorization policies.
- Retention classification.

Use a fake clock for expiry and time-window rules.

## 3. Property-based tests

Valuable invariants:

- Aggregate result is independent of input order.
- Money addition/subtraction is exact.
- Converting weight units round-trips within declared decimal policy.
- Count cannot convert to weight without evidence.
- Accepted/reserved quantity never exceeds allocatable quantity.
- Replayed idempotent command does not duplicate domain state.
- State machines reject every undeclared transition.

## 4. Adapter contract tests

For each external price/messaging adapter:

- Success and pagination/checkpoint behavior.
- Timeout, retryable and terminal errors.
- Empty or delayed data.
- Unknown fields and format changes.
- Duplicate records.
- Partial batch failure.
- Secret/PII redaction.

Use stored synthetic/redacted source fixtures and test parser versions against them.

## 5. Database integration tests

Run against real PostgreSQL/PostGIS, not an in-memory substitute.

Cover:

- Migrations from supported starting state.
- Constraints and indexes.
- Transaction rollback.
- Concurrent offer acceptance/allocation.
- Transactional outbox write/claim/retry.
- Geospatial matching.
- Repository authorization scoping.
- Audit append behavior.

## 6. API tests

- Contract/schema validation.
- Authentication and CSRF behavior.
- Object- and organization-level authorization.
- Idempotency-key behavior.
- Optimistic-concurrency conflicts.
- Cursor pagination stability.
- Rate-limit responses.
- Localized error keys/messages.
- Upload intent and attachment authorization.

Build a matrix asserting that roles cannot access other organizations’ resources.

## 7. End-to-end tests

Critical journeys:

1. View contextual public price and evidence summary.
2. Subscribe/unsubscribe from a price alert.
3. Farmer creates and publishes a sell lot.
4. Buyer publishes requirement and receives a match.
5. Offer/counter/accept creates exactly one Deal Card.
6. Pickup/delivery/accept completes deal.
7. Delivery discrepancy opens and resolves dispute.
8. Operator reviews a price anomaly with audit evidence.
9. Verification revocation removes dependent permission.

Run key journeys in Tamil and English.

## 8. Security tests

- OTP brute force/enumeration resistance.
- Session fixation/revocation.
- Horizontal and vertical authorization.
- Stored/reflected XSS from every text field.
- CSRF.
- Injection.
- Upload type confusion and malicious file handling.
- Signed URL expiry/access isolation.
- SSRF protection for server-side retrieval.
- Sensitive log redaction.

Independent penetration testing is required before broad production launch and before integrated payments.

## 9. Performance tests

Scenarios:

- Cached public price traffic spike after an alert/news event.
- Marketplace search around dense geography.
- Morning batch ingestion and aggregate refresh.
- Notification fan-out with provider slowdown.
- Concurrent offers for one limited lot.

Performance tests must assert correctness under load, not only latency.

## 10. Resilience tests

- Source outage while public prices remain available but stale-labelled.
- Redis/queue restart and job retry.
- Messaging provider failure/circuit breaker.
- Object scanner backlog.
- Database failover/restore drill.
- Worker crash between processing and acknowledgement.
- Duplicate provider webhook.

## 11. Localization and usability

- Native Tamil review for terminology and comprehension.
- Test long labels, numerals, dates and mixed Tamil/English commodity terms.
- Test low-end mobile viewport and coarse touch.
- Test screen reader, keyboard and focus order.
- Test interrupted network and draft recovery.

## 12. Test data

- Synthetic people, phone numbers and organizations.
- Representative Tamil place/product names.
- Boundary quantities and prices.
- Known suspicious unit errors.
- Never use copied production identity or transaction data.

## 13. CI gates

Every change:

- Formatting/lint.
- Typecheck.
- Unit and contract tests.
- Documentation links.
- Secret and dependency scan.

Protected/main changes additionally:

- Database integration tests.
- Application build.
- Critical end-to-end smoke tests.
- Migration validation.

Scheduled:

- Full end-to-end suite.
- External-adapter fixture replay.
- Dependency/container scan.
- Backup restoration exercise according to operations schedule.

