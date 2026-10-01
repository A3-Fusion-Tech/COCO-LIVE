# Price-source runbook

## 1. Purpose

Keep public price data fresh, correctly labelled and reproducible when a source fails, changes format or publishes suspicious values.

## 2. Dashboard signals

For every source display:

- Last retrieval attempt and result.
- Last successful retrieval.
- Latest source observation date/time.
- Records retrieved, normalized, eligible, reviewed and rejected.
- Unknown product/market/unit mappings.
- Price-distribution change versus recent history.
- Aggregate buckets affected.
- Current source status: healthy, delayed, stale, degraded or disabled.

## 3. Source is unavailable

1. Confirm failure is source-specific, not general egress/DNS/credential failure.
2. Inspect status/error without logging credentials or full sensitive responses.
3. Allow bounded automated retries.
4. Mark source delayed after threshold.
5. Keep last-known aggregate only if it remains within display policy; increase visible age and lower confidence as rules dictate.
6. Do not substitute another source silently.
7. Notify operators when public buckets lose minimum evidence.
8. Record incident timeline for prolonged outages.

## 4. Source format changed

1. Pause publication from newly failing records.
2. Preserve raw payloads.
3. Create/update a versioned parser against captured synthetic/redacted fixtures.
4. Verify field semantics and units from authoritative source documentation/contact.
5. Replay affected raw records in staging.
6. Compare output and aggregates with prior expectations.
7. Deploy parser, reprocess, and monitor.

Never “fix” a format change by guessing a column’s meaning.

## 5. Suspicious price spike/drop

1. Identify product, grade, unit, stage and market bucket.
2. Check for unit and decimal errors.
3. Compare independent sources and contributor organizations.
4. Check whether arrivals/quality/holiday/weather context plausibly explains movement.
5. Keep observation in review or publish with adjusted confidence according to policy.
6. Record decision reason and supporting evidence.
7. If a bad price was published, supersede it and evaluate corrective notification.

## 6. Contributor correction

1. Authenticate contributor/operator.
2. Preserve original submission.
3. Record correction reason.
4. Create replacement observation/version.
5. Recompute affected aggregates.
6. Update contributor reliability only through approved policy, not ad hoc punishment.

## 7. Stale-data wording

Approved patterns:

- “Last reported for 30 September, 4:15 PM.”
- “No current verified range; showing the latest official market observation.”
- “Evidence is limited. Confirm with a buyer before making a trade decision.”

Prohibited patterns:

- “Live price” when the source observation is old.
- “Guaranteed price.”
- “Tamil Nadu price” for one thin local market observation.

## 8. Recovery verification

- Source retrieval healthy for consecutive runs.
- Latest observation time advances.
- Mapping/rejection rate returns to expected band.
- No duplicate alerts or observations.
- Affected aggregate calculation is reproducible.
- Operator incident or review task closed with notes.

