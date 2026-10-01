# Privacy and retention

## 1. Data classes

### Public

- Public price aggregates.
- Canonical product/market information.
- Publicly authorized listing summaries.

### Internal operational

- Source mapping and anomaly state.
- Operator notes.
- Non-public marketplace metrics.

### Personal

- Name, phone and language preference.
- Organization membership.
- Coarse and precise locations.
- Communications and consent state.

### Highly restricted

- Identity/business documents.
- Bank/payment destination evidence.
- Precise farm/pickup coordinates before authorized disclosure.
- Dispute evidence containing personal or financial information.
- Security and fraud-investigation signals.

## 2. Collection principles

- State the purpose before collection.
- Collect only what is required for the current action/claim.
- Keep optional fields clearly optional.
- Do not reuse verification documents for unrelated analytics.
- Do not sell contact details or undisclosed leads.
- Record policy/notice version and applicable consent/authorization state.

## 3. Location policy

- Public pages use village/area/market-level location appropriate to risk.
- Exact coordinates/address are encrypted and access-controlled.
- Reveal precise pickup location only to authorized parties at an appropriate deal stage.
- Log location reveal events.
- Strip location metadata from public images.

## 4. Retention schedule design

Final periods require legal review. Configure retention by class rather than one global deletion rule.

| Class | Proposed operational rule |
|---|---|
| Failed OTP attempts | Short security window, then aggregate/delete |
| Inactive unsubmitted drafts | Delete after a short notified period |
| Verification evidence | Retain only while claim and legal/support need justify it; then delete or minimize |
| Published listing history | Retain commercial/audit metadata; remove unnecessary personal/media data on schedule |
| Deal Card and events | Retain for contractual, tax, dispute and legal period |
| Dispute evidence | Restrict and retain through resolution plus reviewed period |
| Raw official price data | Retain for reproducibility where source terms allow |
| Contributor quotes | Retain provenance; minimize contributor exposure in analytics |
| Security logs | Time-bounded according to detection/investigation needs |

## 5. User requests

Support authenticated workflows for:

- Viewing account/profile data.
- Correcting inaccurate profile data.
- Withdrawing optional communication consent.
- Closing an account.
- Requesting applicable deletion/erasure.
- Receiving an explanation when data cannot yet be deleted due to an active deal, dispute or legal retention.

Identity verification for a privacy request must be proportionate and must not collect more evidence than necessary.

## 6. Analytics

- Prefer event IDs and pseudonymous actor IDs.
- Keep raw phone, document and exact location out of analytics.
- Prevent analytics vendors from receiving sensitive page contents.
- Define event schemas and retention.
- Obtain required consent and offer controls before non-essential tracking.

## 7. Non-production data

- Use synthetic fixtures.
- If production-like distributions are necessary, generate them without copying identities or exact locations.
- Production database snapshots are prohibited in developer environments.

## 8. Breach preparedness

Maintain:

- Data inventory and owners.
- Access logs and correlation.
- Credential/key rotation procedures.
- Containment and evidence-preservation steps.
- Assessment and notification decision process aligned with applicable law.
- Tamil and English user-communication templates prepared before production.

