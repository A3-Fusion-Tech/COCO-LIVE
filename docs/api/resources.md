# API resource model

## 1. Public price resources

### Latest prices

`GET /v1/prices/latest`

Suggested filters:

- `productId`
- `marketId` or `areaId`
- `stage`
- `unit`
- `gradeGroup`

Response item:

```json
{
  "priceAggregateId": "pa_...",
  "product": {
    "productId": "prod_mature_coconut",
    "name": "Mature coconut"
  },
  "market": {
    "marketId": "market_pollachi",
    "name": "Pollachi"
  },
  "stage": "FARM_GATE",
  "tradeTerm": "EX_FARM",
  "range": {
    "low": { "amountPaise": 2900, "currency": "INR" },
    "reference": { "amountPaise": 3050, "currency": "INR" },
    "high": { "amountPaise": 3200, "currency": "INR" },
    "perUnit": "NUT"
  },
  "observedWindow": {
    "startsAt": "2026-10-01T06:30:00+05:30",
    "endsAt": "2026-10-01T09:15:00+05:30"
  },
  "confidence": "MEDIUM",
  "evidenceSummary": {
    "observations": 8,
    "independentOrganizations": 5,
    "officialMarketObservations": 1,
    "verifiedQuotes": 6,
    "completedTrades": 1
  },
  "calculationVersion": "weighted-median-v1"
}
```

## 2. Sell lot resource

Key representation fields:

- `sellLotId`
- `sellerSummary`
- `organizationSummary`
- `product`
- `gradeAttributes`
- `quantityAvailable`
- `partialFulfilmentAllowed`
- `originArea`
- `availableWindow`
- `expiresAt`
- `fulfilmentTerm`
- `commercialCosts`
- `priceExpectation`
- `media`
- `verificationClaims`
- `status`
- `version`

Public/search views omit precise location, private evidence and internal risk fields.

## 3. Buy requirement resource

Key fields mirror the sell lot but describe target/minimum quantity, destination/pickup radius, required window, acceptable grade constraints and recurring-instance reference.

## 4. Offer resource

```json
{
  "offerId": "offer_...",
  "threadId": "neg_...",
  "revision": 3,
  "previousOfferId": "offer_...",
  "createdByPartyId": "party_...",
  "quantity": { "value": "5000", "unit": "NUT" },
  "unitPrice": {
    "money": { "amountPaise": 3000, "currency": "INR" },
    "perUnit": "NUT"
  },
  "commercialCosts": [],
  "fulfilmentWindow": {},
  "paymentTerms": {},
  "inspectionTerms": {},
  "expiresAt": "2026-10-01T14:00:00+05:30",
  "status": "ACTIVE",
  "version": 1
}
```

The server computes an estimated total but does not replace explicit unit-price and final weighment/count rules.

## 5. Deal resource

The deal response separates:

- Current operational status.
- Immutable Deal Card revisions.
- Append-only event timeline.
- Authorized evidence summaries.
- Payment confirmations, not payment guarantees.
- Dispute state.

## 6. Verification summary

Expose claim summaries without evidence documents:

```json
{
  "type": "ORGANIZATION_EXISTENCE",
  "status": "APPROVED",
  "verifiedAt": "2026-09-20T10:00:00+05:30",
  "expiresAt": null,
  "displayLabel": "Organization documents checked"
}
```

## 7. Operations resources

Operator queue items contain:

- Queue/type/priority.
- Subject and safe summary.
- Reasons/signals.
- Age/SLA.
- Required capability.
- Allowed decisions and required fields.

The response should avoid downloading sensitive evidence until the operator explicitly opens a permitted case.

