# Product requirements

## 1. Objective

LiveCoco helps Tamil Nadu coconut-market participants answer two questions:

1. What is a credible current price for this specific product, grade, unit, location and commercial term?
2. Who can execute a trade under clearly documented conditions?

The MVP is not a consumer-delivery application, an anonymous classifieds board, a lender or a platform-held wallet.

## 2. Product principles

- **Context before price:** Never show a number without product, unit, place, stage, source and time.
- **Range before false precision:** Display an evidence-backed range unless there is an actual executable offer.
- **Trust is granular:** Mobile, identity, organization, document and stock verification are separate claims.
- **Demand-led liquidity:** Recruit repeat buyers before broad seller acquisition.
- **Assisted, not purely self-service:** Operators, phone and WhatsApp are valid parts of the MVP.
- **Tamil first:** Tamil is a complete primary experience, not a partial translation.
- **Explainable matching:** Users and operators can understand why a lot and requirement match.
- **Immutable commercial history:** Accepted terms and material amendments remain auditable.

## 3. Initial geography and catalog

### Supply geography

- Pollachi
- Anaimalai
- Kinathukadavu
- Udumalpet
- Selected Sulur/Palladam aggregation points

### Initial products

- Mature coconut, with and without husk
- Tender coconut
- Milling copra
- Ball copra

No product is enabled until its unit options, required attributes, quality guidance and compatible market stages are configured.

## 4. Functional requirements

### PR-1: Public price discovery

Users must be able to view current/latest reported price ranges without signing in.

Each display must include:

- Canonical product and optional grade.
- Location or market.
- Unit.
- Market stage and trade term.
- Low/high and reference value when supported.
- Observation time and freshness.
- Source class and confidence.
- Included/excluded commercial costs when known.
- A plain-language explanation that reference prices are not guaranteed offers.

Acceptance criteria:

- Incompatible product/unit/stage records are never combined.
- Stale data is visibly labeled rather than silently presented as current.
- MSP is shown as a policy reference, not a live market quote.
- The user can inspect a summarized evidence breakdown without seeing contributor-private information.

### PR-2: Price alerts

Authenticated users can subscribe to product/location/unit thresholds or a scheduled bulletin.

Acceptance criteria:

- Consent and preferred channel are recorded.
- Repeated observations inside the threshold do not create notification spam.
- Every alert identifies its source time and links to the contextual price page.
- Users can pause or cancel alerts through the same channel or app.

### PR-3: Seller onboarding

A seller can create an account with phone OTP and choose whether they act independently or for an organization.

Acceptance criteria:

- Only essential profile data is required for viewing prices.
- Additional verification is requested when the action requires it.
- Precise farm location is not exposed publicly.
- An agent must disclose that the lot is listed for someone else.

### PR-4: Sell lot

A farmer, FPO or authorized seller can publish a time-bounded lot.

Required activation data:

- Product and relevant quality attributes.
- Quantity/range and unit.
- Origin area.
- Available date/window and expiry.
- Pickup/delivery term.
- Expected price or invite-offer selection.
- Cost inclusions/exclusions.
- At least one current photo unless an approved operator records a justified exception.

Acceptance criteria:

- Drafts survive interrupted connectivity.
- Product-specific validation is applied.
- Listings expire automatically.
- Material edits after receiving offers create a visible revision and invalidate incompatible offers.
- Seller can withdraw an unreserved lot.

### PR-5: Buy requirement

A verified buyer can publish one-time or recurring demand.

Acceptance criteria:

- Quantity, unit, grade, location, required date and fulfilment term are explicit.
- Recurring demand produces dated instances.
- Requirements expire or close when filled.
- Buyers cannot advertise prohibited or unrelated requests.

### PR-6: Matching

The system produces explainable candidates based on product, grade, quantity, date, radius, verification and optional price overlap.

Acceptance criteria:

- Matching never commits a trade.
- Users can see the main match reasons and incompatibilities.
- Operators can manually assist without changing underlying user terms.
- Suspended, expired and blocked participants are excluded.

### PR-7: Offer negotiation

Eligible users can create, counter, accept or reject a structured offer.

Acceptance criteria:

- Offers have an expiry.
- Commercial terms include quantity, price, unit, grade, fulfilment, costs, weighment/count and payment timing.
- Counter-offers are immutable revisions.
- Only one compatible offer can reserve the same quantity at a time.
- Acceptance is transactional and cannot oversell the lot.

### PR-8: Deal Card and fulfilment

Accepting an offer creates a Deal Card and an operational timeline.

Acceptance criteria:

- The card captures the complete accepted terms.
- A material amendment requires both parties’ acceptance.
- Pickup, delivery, acceptance, payment confirmation and cancellation are recorded as events.
- Evidence is access-controlled and time-stamped.
- LiveCoco does not claim payment guarantee in v1.

### PR-9: Disputes

Either party can open a dispute within the configured acceptance window.

Acceptance criteria:

- Reason, claimed quantity/amount and evidence are structured.
- Counterparties receive a response window.
- Operators see the Deal Card and event history but cannot silently alter them.
- Resolution records outcome, reason and operator.

### PR-10: Operations

Authorized operators can review price observations, verification cases, listings, risk signals and disputes.

Acceptance criteria:

- Queue actions require reasons.
- Sensitive documents are visible only to the minimum role.
- Every privileged action is audited.
- Operators cannot use administrative endpoints through ordinary user sessions without step-up authorization.

## 5. Non-functional requirements

### Accessibility and language

- All primary workflows are keyboard and screen-reader operable.
- Touch targets support field use.
- Tamil and English use stable message keys and locale-aware formatting.
- Essential meaning never depends only on color.

### Performance

- Public cached price page target: p75 under 2.5 seconds on a representative low-end Android device and constrained mobile network.
- Authenticated interaction target: p95 server response under 500 ms for ordinary reads/writes, excluding external providers.
- Images are resized and compressed after safe decoding.

### Reliability

- Public prices remain readable during temporary notification-provider failure.
- Source failures do not erase last-known values; they change freshness/state.
- Background jobs retry safely without duplicate alerts or events.

### Security and privacy

- Server-side capability checks.
- Rate-limited OTP and write endpoints.
- Private verification/evidence storage.
- Coarse public locations.
- Audited privileged actions.
- Documented retention and account closure.

## 6. Explicit exclusions from MVP

- Platform wallet or escrow.
- Credit underwriting.
- Guaranteed purchase or logistics.
- AI grade certification.
- Consumer last-mile grocery ordering.
- Open anonymous messaging.
- Automated dispute judgment.
- Statewide launch before pilot liquidity gates are met.

## 7. Product metrics

Primary metric: verified completed trade value with repeat counterparties.

Supporting metrics:

- Price freshness and source diversity by bucket.
- Qualified response within 24 hours.
- Median time to first offer.
- Offer acceptance and deal completion rates.
- Repeat buyer and seller rate.
- Cancellation, rejection and dispute rates.
- Net realization improvement where a credible alternative is recorded.
- Manual-operations minutes per completed deal.

