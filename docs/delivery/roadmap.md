# Delivery roadmap

## Guiding rule

Prove price trust before marketplace liquidity; prove marketplace liquidity before operational guarantees.

## Phase 0: discovery and concierge operations

**Objective:** Validate vocabulary, price sources and buyer demand without committing to complex software.

### Work

- Interview farmers, FPOs, traders, processors, buyers and logistics providers.
- Observe real trades from quote to payment.
- Define canonical products, units, grade attributes and costs.
- Recruit a diversified verified price panel.
- Operate morning/afternoon bulletin manually.
- Record requirements and assisted matches in a structured internal system.

### Deliverables

- Validated catalog and local terminology.
- Source/contributor agreements and consent.
- Initial data-quality policy.
- Pilot buyer and seller cohort.

### Exit criteria

- Repeat participation from verified sources.
- Clear evidence users act on contextual prices.
- At least 20–30 repeat-capable buyers/processors recruited before broad farmer onboarding.

## Phase 1: price-intelligence vertical slice

**Objective:** Publish defensible Pollachi-area coconut prices.

### Engineering sequence

1. Bootstrap monorepo applications, CI and local infrastructure.
2. Implement identity for operators/contributors.
3. Implement catalog and database migrations.
4. Implement raw price-source storage.
5. Implement AGMARKNET adapter and mapping review queue.
6. Implement contributor quote entry.
7. Implement validation and weighted aggregation.
8. Implement public Tamil/English price pages.
9. Implement source health, audit and alerts.

### Exit criteria

- Reproducible price aggregate from raw sources.
- Minimum source-diversity rule enforced.
- Observation age and confidence visible.
- Stale source behavior tested.
- Four weeks of reliable operations.

## Phase 2: assisted marketplace

**Objective:** Convert price-page users into qualified supply/demand leads.

### Engineering sequence

1. User and organization onboarding.
2. Granular verification claims.
3. Sell lots and buy requirements.
4. Product-specific validation and media processing.
5. Explainable deterministic matching.
6. Contact reveal and block/report.
7. Assisted-operations queue.

### Exit criteria

- 70% of active requirements receive a qualified match within 24 hours.
- Stale/duplicate listing rate within target.
- Privacy/security review passed.
- Operators can resolve common exceptions without database access.

## Phase 3: structured trade execution

**Objective:** Make agreed terms and outcomes reliable enough to drive repeat trade.

### Engineering sequence

1. Offers and counter-offers.
2. Concurrency-safe allocation/reservation.
3. Deal Card and amendments.
4. Inspection/weighment/pickup/delivery events.
5. Direct-payment confirmation.
6. Dispute workflow.
7. Outcome-derived reputation.

### Exit criteria

- 30% buyer repeat within 60 days.
- Fewer than 5% unresolved disputes among completed deals.
- No material allocation/Deal Card integrity defect.
- Operations effort per deal supports viable economics.

## Phase 4: FPO and partner fulfillment

**Objective:** Increase volume and reduce execution friction.

### Work

- Member-lot aggregation and allocation.
- Settlement export.
- Inspection partner portal/integration.
- Logistics quote/referral and status.
- Reusable procurement templates and supplier relationships.

### Exit criteria

- Partner SLA and error/dispute attribution measurable.
- FPO member settlement verified with pilot partners.
- Commercial terms and liability reviewed.

## Phase 5: managed settlement and expansion

**Objective:** Add payment orchestration and expand only after the core market works.

### Preconditions

- Payment failure is a measured material blocker.
- Regulated provider and legal/tax model approved.
- Reconciliation, refund and support staffing designed.
- Fraud-loss and dispute ownership defined.

### Potential work

- Marketplace settlement provider.
- Reconciliation ledger and webhooks.
- Additional Tamil Nadu clusters/products.
- Buyer procurement API.
- Advanced analytics.

## Backlog explicitly after evidence

- AI image grading.
- Credit/financing.
- Automated price forecasting.
- Consumer commerce.
- Interstate expansion.
- Independent microservices/search warehouse.

