# Price intelligence design

## 1. Purpose

The price system must publish useful market evidence without claiming that delayed, incomparable or unverifiable numbers are “live.” Its central property is traceability: every public figure can be explained from eligible observations.

## 2. Canonical price dimensions

A price bucket is compatible only when these dimensions match or an explicit, reviewed aggregation rule allows grouping:

- Product
- Grade definition/version or compatible grade group
- Unit
- Market stage
- Trade term
- Geography/market area
- Currency
- Time window

Mature coconut per nut at farm-gate is not compatible with mature coconut per kilogram at retail. Milling copra is not compatible with ball copra. An MSP benchmark is not an executable quote.

## 3. Source adapters

Every adapter implements:

```text
fetch(cursor) -> RawBatch
identify(rawRecord) -> SourceRecordId
parse(rawRecord) -> ParsedCandidate
checkpoint(result) -> Cursor
```

Requirements:

- Idempotent retrieval and record hashing.
- Bounded retries with jitter.
- Raw payload saved before parsing.
- Retrieval metadata: HTTP status/provider status, request ID, received time and parser version.
- No credentials or personal tokens in raw payload logs.
- Replay support from stored raw records.

## 4. AGMARKNET/data.gov.in adapter

Initial resource ID: `9ef84268-d588-465a-a308-a864a43d0070`.

Expected fields include state, district, market, commodity, variety, grade, arrival date, minimum price, maximum price and modal price.

Rules:

- Filter for relevant Tamil Nadu products where server-side filtering is reliable, but preserve defensive filtering locally.
- Treat the source date as an observation/reporting date, not retrieval time.
- Do not invent missing arrival quantities.
- Store prices in their documented source unit and normalize only after confirming unit semantics.
- A record arriving today with an older market date remains older data.
- Source catalog changes trigger a review rather than silently remapping.

## 5. Contributor quotes

A verified quote submission requires:

- Contributor identity and organization.
- Approved market/product scope.
- Product and grade.
- Price or price range and unit.
- Market stage and trade term.
- Observation time.
- Quantity represented or minimum executable quantity.
- Quote expiry if executable.
- Cost inclusions/exclusions.
- Optional evidence and operator notes.

Contributors cannot approve their own anomaly reviews or change source reliability weights.

## 6. Validation stages

### Schema validation

- Required fields present.
- Parseable decimal, date and enum values.
- Non-negative money and quantity.
- Low price does not exceed high price.

### Catalog mapping

- Source commodity maps to a canonical product.
- Market maps to a known market/location.
- Grade and unit are known or enter an unmapped queue.

### Semantic validation

- Product supports the unit and market stage.
- Observation time is plausible.
- Executable quote has expiry and quantity.
- Required product-quality attributes are present when configured.

### Anomaly validation

Signals include:

- Change beyond configured robust historical bounds.
- Extreme distance from independent same-window sources.
- Suspicious repeated exact values.
- Contributor submitting incompatible prices across linked accounts.
- Unit-error patterns such as per-nut value appearing as per-kilogram.

An anomaly signal does not automatically mean fraud. It determines publish, down-weight or review behavior.

## 7. Eligibility states

```text
RECEIVED
  → NORMALIZED
  → ELIGIBLE
  → PUBLISHED

RECEIVED/NORMALIZED
  → NEEDS_REVIEW
  → ELIGIBLE | REJECTED

PUBLISHED
  → SUPERSEDED | WITHDRAWN
```

Historical public aggregates retain which observation versions contributed at calculation time.

## 8. Aggregation method

### Weight components

Let each eligible observation have:

- `sourceWeight`: reliability of source tier and contributor track record.
- `freshnessWeight`: decay based on market observation time.
- `geographyWeight`: exact market versus nearby reference market.
- `gradeWeight`: exact versus accepted compatible grade.
- `executionWeight`: completed trade/executable quote/reference report.

The final weight is bounded; no source can dominate purely by submission frequency.

### Robust calculation

1. Group compatible observations.
2. Collapse repeated observations from the same organization/time window where necessary.
3. Compute a weighted median reference.
4. Compute robust low/high weighted percentiles.
5. Measure dispersion relative to reference.
6. Store aggregate inputs and calculation version.

Do not expose a derived aggregate when minimum evidence rules are not met. Show individual official/reference records or “insufficient current evidence” instead.

## 9. Confidence classification

Confidence factors:

- Observation count.
- Independent organization count.
- Source-tier diversity.
- Age of newest and oldest contributing evidence.
- Dispersion.
- Grade/geographic exactness.
- Presence of completed trades or executable quotes.
- Unresolved anomaly share.

Example policy:

### High

- At least five eligible observations.
- At least three independent organizations.
- Evidence within target freshness.
- Dispersion below configured threshold.
- No critical unresolved anomaly.

### Medium

- At least three eligible observations from two organizations, or strong official data plus one independent verified source.
- Acceptable but not ideal freshness/dispersion.

### Low

- Thin, old or geographically substituted evidence.

Low confidence must be visible and must not trigger strong marketing claims.

## 10. Public presentation rules

Always display:

- “Observed/reported at,” not just “updated at.”
- Product, grade, unit, stage and geography.
- Range and confidence.
- Evidence-source classes and count.
- Trade-term caveat.

Never display:

- Contributor names without authorization.
- A statewide average as if it applies to every farm.
- A converted per-nut price inferred from generic average weight.
- Yesterday’s value under a “live now” label.
- MSP inside the same range as market quotes.

## 11. Corrections

- Corrections never mutate the raw record.
- A correction references the affected observation and states reason, actor and time.
- Recompute affected aggregates.
- If a widely viewed/pushed price changes materially, generate an operator review for corrective communication.

## 12. Testing invariants

- Input order does not change aggregate result.
- Duplicating one organization’s observation does not improperly increase diversity.
- Incompatible units never aggregate.
- Older evidence never becomes fresher because it was re-ingested.
- A rejected observation never contributes.
- Calculation version and contributing observation IDs reproduce a historical aggregate.

