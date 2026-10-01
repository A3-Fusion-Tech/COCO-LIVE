# Identity and verification

## 1. Separation of concerns

Authentication proves control of a login method. Verification supports a specific claim. Reputation summarizes observed platform outcomes. They are not interchangeable.

## 2. Authentication

### OTP login

- Normalize phone numbers to an international canonical form.
- Do not reveal whether a number exists before an OTP is successfully verified.
- Rate-limit by phone, device, IP/risk cluster and time window.
- OTPs are short-lived, single-use and stored as secure hashes where applicable.
- Successful verification invalidates previous attempts.
- Sensitive operator actions require step-up authentication.

### Sessions

- Use secure, HTTP-only, same-site cookies for web sessions where possible.
- Rotate session identifiers after authentication and privilege changes.
- Support remote revocation and device/session listing.
- Suspend all sessions when account risk requires it.

## 3. Verification claims

Claim types may include:

- `MOBILE_CONTROL`
- `PERSON_IDENTITY`
- `ORGANIZATION_EXISTENCE`
- `ORGANIZATION_MEMBERSHIP`
- `BUSINESS_DOCUMENT`
- `FSSAI_DOCUMENT`
- `GST_DOCUMENT`
- `MARKET_LICENSE_DOCUMENT`
- `PAYMENT_DESTINATION`
- `PRICE_CONTRIBUTOR_SCOPE`
- `LOT_STOCK`

Each claim records scope and expiry. For example, stock verification references one sell lot; price-contributor approval references allowed markets and products.

## 4. Verification workflow

```text
NOT_STARTED → EVIDENCE_REQUESTED → SUBMITTED → IN_REVIEW
                                      ↘ NEEDS_MORE_INFORMATION
IN_REVIEW → APPROVED | REJECTED | EXPIRED | REVOKED
```

Requirements:

- Evidence checklist depends on claim type and user category.
- Operator cannot decide a case where conflict-of-interest policy excludes them.
- Decisions require reason codes and optional private notes.
- Rejection does not expose sensitive internal fraud logic.
- Revocation invalidates dependent permissions and creates notifications/audit events.

## 5. Public presentation

Display exact claims in understandable language:

- “Mobile number verified”
- “Organization documents checked”
- “Approved price contributor for Pollachi mature coconut”
- “Stock checked on 1 Oct, 9:00 AM”

Never use one undifferentiated badge labelled only “Verified.”

## 6. Organization membership

Membership roles are organization-scoped. A trader’s employee should not inherit permissions in another organization they also belong to.

High-risk membership changes—owner transfer, finance role, verifier role—require re-authentication and notifications to existing administrators.

## 7. Operator access

- Dedicated operator capabilities.
- Least-privilege queues.
- Sensitive document access logged separately.
- Production support impersonation is prohibited; use audited “view as context” tools that never forge user actions.
- Two-person approval for bulk export or exceptional overrides when implemented.

