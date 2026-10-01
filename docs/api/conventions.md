# API conventions

## 1. Style and versioning

- JSON over HTTPS.
- Resource-oriented REST endpoints under `/v1`.
- Breaking changes require a new major API version or a compatible migration period.
- Internal events have independently versioned schemas.
- Dates/times use RFC 3339 with offsets in responses; canonical storage uses UTC instants.

## 2. Naming

- JSON property names use `camelCase`.
- Stable identifiers are opaque strings; clients must not infer meaning from them.
- Enum values use `UPPER_SNAKE_CASE`.
- IDs include semantic field names such as `sellLotId`, not generic `id` where ambiguity exists.

## 3. Money and quantity

Money:

```json
{
  "amountPaise": 3050,
  "currency": "INR"
}
```

Quantity:

```json
{
  "value": "2500",
  "unit": "NUT"
}
```

Decimal quantities are strings in JSON to avoid binary floating-point ambiguity.

Unit price:

```json
{
  "money": { "amountPaise": 3050, "currency": "INR" },
  "perUnit": "NUT"
}
```

## 4. Localized content

APIs return stable codes and structured values. Human-facing responses may include:

```json
{
  "messageKey": "offer.expired",
  "message": "This offer has expired."
}
```

The server chooses `message` from the requested supported locale, but clients must not branch logic on translated text.

## 5. Errors

Use a consistent problem response:

```json
{
  "type": "https://docs.livecoco.example/problems/offer-expired",
  "title": "Offer expired",
  "status": 409,
  "code": "OFFER_EXPIRED",
  "messageKey": "offer.expired",
  "detail": "The offer expired before it could be accepted.",
  "correlationId": "req_...",
  "fieldErrors": []
}
```

Expected status use:

- `400` malformed request.
- `401` authentication required/invalid.
- `403` authenticated but not authorized.
- `404` absent or intentionally undisclosed resource.
- `409` state/version/idempotency conflict.
- `422` semantically invalid fields.
- `429` rate limited.
- `503` temporarily unavailable dependency or operation.

Never expose stack traces, SQL, provider credentials or sensitive risk rules.

## 6. Idempotency

Commands creating commercial or notification-relevant state require an `Idempotency-Key` header.

- Scope keys by authenticated actor, endpoint and payload hash.
- Repeating the same key and payload returns the original result.
- Reusing a key with a different payload returns `409`.
- Retain keys long enough to cover realistic mobile retries.

## 7. Optimistic concurrency

Mutable resources expose a `version` or ETag. Commands that could overwrite another decision require `If-Match` or expected version.

Offer acceptance uses transactional domain checks even when an ETag is supplied; client concurrency controls do not replace database locking.

## 8. Pagination

Use opaque cursor pagination:

```json
{
  "items": [],
  "page": {
    "nextCursor": "opaque-or-null",
    "hasMore": false
  }
}
```

Stable ordering includes a unique tie-breaker. Cursors are validated and expire when policy requires it.

## 9. Filtering and sorting

- Explicit allowlist per endpoint.
- Repeated query parameters for multiple values where appropriate.
- Distance filters require an authorized/coarse reference location.
- Sort options are named (`NEWEST`, `DISTANCE`, `BEST_MATCH`) rather than accepting raw database columns.

## 10. Authentication and authorization

- Browser clients use secure session cookies where supported.
- CSRF protection applies to cookie-authenticated mutations.
- Every protected endpoint declares required capabilities.
- Organization context is explicit and verified against membership.
- Operator endpoints use separate capabilities and stronger session policy.

## 11. Uploads

1. Client requests an authorized upload intent with type and size.
2. API returns a short-lived signed destination.
3. Client uploads directly to private storage.
4. Worker scans and safely decodes media.
5. API attaches only approved media to the domain record.

Unscanned files are never served to other users.

## 12. Audit and correlation

- Accept or generate a correlation ID at the edge.
- Propagate it to logs, traces, jobs and provider calls.
- Commercial commands include actor, organization context and device/session reference in audit metadata.
- Do not log OTPs, document content, full phone numbers or precise coordinates.

## 13. Rate-limit responses

Return `429` with a safe retry indication where possible. Avoid revealing risk-model detail. OTP limits should not enable phone-number enumeration.

## 14. API documentation

Generate an OpenAPI document from the canonical contract schemas. Published examples must use synthetic data and cover Tamil content/formatting where human text appears.

