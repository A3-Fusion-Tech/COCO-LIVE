# Marketplace lifecycle

## 1. Marketplace model

LiveCoco begins as verified information and lead facilitation, then adds structured deals. It is not initially merchant-of-record, custodian of funds or guarantor of quality, payment or logistics.

## 2. Sell-lot lifecycle

### Draft

Visible only to authorized seller/organization members and assisting operators. May be incomplete.

### Pending review

Used when policy requires manual review, stock evidence or a new participant check.

### Active

Discoverable to eligible buyers. Receives matches and offers until expiry or allocatable quantity is exhausted.

### Reserved

Some or all allocatable quantity is committed to an accepted offer. Partial reservation keeps remaining quantity active if the seller allowed partial fulfilment.

### Sold

All allocatable quantity has completed or the seller closes the remainder after fulfilment.

### Expired, withdrawn, suspended

Terminal for new offers. Historical views remain available to authorized parties.

## 3. Requirement lifecycle

Requirements distinguish target quantity from minimum acceptable fulfilment and whether partial matches are allowed.

A recurring requirement is a template containing cadence and defaults. The scheduler creates executable dated instances. Editing the template affects future instances only.

## 4. Matching policy

### Hard filters

- Same canonical product.
- Compatible grade attributes.
- Quantity overlap and partial-fill policy.
- Availability/required window overlap.
- Fulfilment geography/radius.
- Required verification claims.
- Active account and market-object status.
- No block or policy exclusion.

### Ranking factors

- Exact grade match.
- Net distance/route suitability.
- Quantity coverage.
- Availability proximity.
- Counterparty completion history.
- Existing successful trading relationship.
- Price overlap when specified.

### Explainability

Every candidate stores reason codes, for example:

```text
PRODUCT_EXACT
GRADE_EXACT
QUANTITY_COVERS_82_PERCENT
PICKUP_WITHIN_18_KM
AVAILABLE_ONE_DAY_BEFORE_REQUIRED
IDENTITY_AND_ORG_VERIFIED
```

Negative/incompatibility reasons should also be visible to operators.

## 5. Negotiation

### Offer creation

Before allowing an offer, verify:

- Actor capability and organization membership.
- Counterparty/object eligibility.
- Requested quantity remains available.
- Offer expiry is reasonable.
- Money/unit/product combination is valid.
- Contact-reveal and abuse limits.

### Counter-offer chain

An offer chain is linear for a negotiation thread. Creating a counter-offer makes the prior offer no longer directly acceptable unless product policy explicitly permits reopening.

### Acceptance concurrency

Use a database transaction and row/version lock:

1. Reload current offer.
2. Reject if expired, superseded or inactive.
3. Lock lot/requirement allocation.
4. Verify remaining quantity.
5. Accept offer and reserve allocation.
6. Create deal, card and events.

Return a conflict response if another acceptance won the race.

## 6. Deal Card fields

- Parties and acting organizations.
- Lot/requirement snapshots.
- Product and grade-attribute snapshot.
- Quantity, tolerance and unit.
- Unit price, currency and total calculation rule.
- Pickup/delivery location disclosure.
- Fulfilment window.
- Harvesting/dehusking/loading/transport/commission/tax responsibilities.
- Weighment or count method and location.
- Inspection and rejection rules.
- Payment method and due condition/time.
- Acceptance window.
- Cancellation terms.
- Offer/revision provenance.

Derived totals are stored with the calculation inputs/version or recomputable from the immutable card.

## 7. Fulfilment evidence

Evidence types:

- Time-stamped lot photo.
- Inspection result.
- Weighment slip.
- Count confirmation.
- Pickup acknowledgement.
- Vehicle/consignment reference.
- Delivery acknowledgement.
- Payment confirmation.
- Communication/operations note where legally and operationally appropriate.

Evidence visibility is type- and role-specific. Verification documents and precise locations are never placed in ordinary public media paths.

## 8. Acceptance and disputes

Delivery begins a configured acceptance window. The buyer may:

- Accept.
- Report a structured discrepancy.
- Take no action, allowing policy-defined deemed acceptance only if clearly agreed in the Deal Card.

Dispute reasons include:

- Quantity/count variance.
- Grade/quality mismatch.
- Damage/contamination.
- Delivery timing/location failure.
- Undisclosed deduction or charge.
- Payment delay/non-payment.
- Counterparty no-show.

LiveCoco operators facilitate documentation and resolution under published policy; they must not retroactively change agreed terms.

## 9. Reputation

Do not begin with public five-star ratings. Generate reputation events from observable outcomes:

- Deal completed.
- Pickup/delivery on time.
- Accepted quantity versus agreed quantity.
- Cancellation attribution.
- Dispute opened and outcome.
- Payment confirmation timing.
- Verified repeat relationship.

Public reputation summaries require minimum sample sizes and protection against retaliation. Free-text feedback remains private to operations initially.

## 10. Contact reveal

- Mutual interest or accepted workflow gate.
- Rate-limited per account/device.
- Log who revealed whose contact and why.
- Allow proxy calling/masked contact if operationally feasible.
- Provide block/report immediately.
- Do not expose precise farm address together with an unrestricted phone number on public pages.

