# Domain model

## 1. Bounded modules

### Identity and Access

Owns user authentication, sessions, capabilities and account status. It knows whether an actor is authorized but does not decide business verification outcomes.

### Party and Verification

Owns people, organizations, memberships, verification cases and claims. A verification claim has type, subject, evidence reference, issuer/operator, decision time and optional expiry.

### Catalog

Owns canonical products, aliases, grade definitions, attributes, units, markets and geography. Other modules reference catalog IDs rather than inventing free-text product names.

### Price Intelligence

Owns sources, contributors, raw records, normalized observations, validation, review tasks, aggregates, corrections and price alerts.

### Marketplace

Owns sell lots, buy requirements, availability, matching candidates and visibility. It does not own accepted commercial agreements.

### Negotiation and Deals

Owns offers, counter-offers, reservations, Deal Cards, amendments and fulfilment events.

### Trust and Safety

Owns risk signals, reputation events, reports, blocks, disputes and moderation actions.

### Communications

Owns channel preferences, message intents, templates, provider delivery attempts and opt-out state.

### Operations and Audit

Owns operator work queues, privileged-action audit and cross-module operational views.

## 2. Principal aggregates

### User

Invariants:

- A mobile number cannot be active on multiple ordinary user accounts without an explicit account-recovery/merge process.
- Suspended users cannot create market activity.
- Session state is revocable.

### Organization

Invariants:

- Membership invitations do not grant access before acceptance.
- Only authorized managers can change membership.
- Verification claims apply to the organization and do not automatically verify all members personally.

### Product and grade definition

Invariants:

- Grade attributes are typed and versioned.
- Historical observations retain the grade-definition version used at normalization.
- Product aliases may map source-specific terms to one canonical product but may not collapse materially different products.

### Price source

Invariants:

- Source tier and ownership are explicit.
- Retrieval configuration is secret-safe and versioned outside ordinary data.
- Disabling a source prevents new publication but does not delete history.

### Price observation

Invariants:

- Links to exactly one raw source record or one authenticated contributor submission.
- Original unit and value remain available.
- Published eligibility is a decision state, not inferred from a non-null price.
- Corrections create a correction record and replacement observation/version.

### Sell lot

Invariants:

- Active quantity cannot be negative.
- Reserved plus completed quantity cannot exceed declared allocatable quantity.
- Activation requires product-specific fields.
- An expired, withdrawn or suspended lot cannot receive new offers.

### Buy requirement

Invariants:

- Required quantity and date/window are explicit.
- Filled quantity cannot exceed requested quantity unless the buyer accepts an amendment.
- Recurring templates are not themselves executable requirements.

### Offer

Invariants:

- Immutable after creation.
- References a lot, requirement or both.
- Expiry must be after creation.
- Acceptance requires both referenced market objects to remain eligible.
- Counter-offer references exactly one prior offer.

### Deal

Invariants:

- Created only from an accepted offer.
- Contains an immutable initial Deal Card.
- Material amendments require acceptance by both counterparties.
- State transitions are validated and append an event.
- Completion cannot erase a preceding dispute or amendment.

### Dispute

Invariants:

- References one deal and one initiating party.
- Captures the Deal Card revision active at the disputed event.
- Resolution is append-only and attributed to an authorized actor.

## 3. Value objects

### Money

```text
Money {
  amountPaise: integer
  currency: "INR"
}
```

Never use binary floating-point for money.

### Quantity

```text
Quantity {
  value: decimal
  unit: NUT | KG | QUINTAL | TONNE | LITRE | LOAD | ...
}
```

Conversions require a registered dimension conversion. Count-to-weight conversion additionally requires observed lot evidence.

### Price

```text
UnitPrice {
  money: Money
  per: QuantityUnit
}
```

### Time window

```text
TimeWindow {
  startsAt: instant
  endsAt: instant
  timezone: IANA timezone
}
```

Persist instants in UTC and retain the relevant market/user timezone for rendering and rules.

### Location disclosure

```text
LocationRef {
  publicAreaId: identifier
  preciseLocationEncrypted: optional coordinates/address
  disclosurePolicy: enum
}
```

### Commercial costs

Represent each known cost responsibility separately:

- Harvesting
- Dehusking
- Sorting/grading
- Loading
- Commission
- Transport
- Unloading
- Inspection
- Tax

Each item records responsible party, included-in-unit-price state, amount/rule if known and free-text clarification only when necessary.

## 4. Cross-module workflows

Use application services to orchestrate aggregates within one database transaction where possible. Publish an outbox event for work outside the transaction.

Example: offer acceptance

1. Authorize buyer/seller acceptance actor.
2. Lock offer and allocatable lot quantity.
3. Verify offer active and not expired.
4. Verify lot/requirement eligibility and quantity.
5. Mark offer accepted.
6. Reserve quantity.
7. Create deal and initial Deal Card.
8. Write audit and outbox events.
9. Commit.
10. Notify parties asynchronously.

## 5. Deletion policy

Business deletion is usually state transition or de-identification, not row removal.

- Drafts without dependencies may be hard-deleted after a short retention window.
- Published records retain audit history.
- User account closure removes access and schedules personal-data review/de-identification.
- Legally or operationally required transaction evidence is retained according to policy with access minimized.
- Raw government price records and non-personal aggregates can be retained for historical analysis.

