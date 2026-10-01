# Threat model

## 1. Protected assets

- User mobile numbers and account recovery paths.
- Identity and business-verification documents.
- Precise farm, pickup and delivery locations.
- Buyer/seller relationship graph.
- Price contributor identity and private quotes.
- Accepted commercial terms and transaction evidence.
- Operator capabilities and audit records.
- API/provider credentials and encryption keys.
- Marketplace integrity and public-price credibility.

## 2. Trust boundaries

- Unauthenticated browser to public edge.
- Authenticated user device to API.
- Operator device to privileged API.
- API/worker to database, queue and object storage.
- Worker to government data, messaging and future partners.
- Direct user-to-user contact after reveal.

Every external payload is untrusted, including government-source responses, contributor submissions, photos, documents and provider webhooks.

## 3. Principal threats

### Account takeover and OTP abuse

Attacks:

- OTP guessing, replay or interception.
- SIM-swap/social recovery abuse.
- Session theft.
- Phone-number enumeration.

Controls:

- Short-lived single-use OTPs.
- Multi-dimensional attempt limits and risk checks.
- Generic pre-verification responses.
- Secure cookie/session rotation and revocation.
- Step-up authentication for sensitive actions.
- Notifications for security-critical changes.

### Authorization failure

Attacks:

- Access another organization’s lots, offers, evidence or documents.
- Ordinary user reaching operator actions.
- Former employee retaining organization access.

Controls:

- Server-side capability and organization-scope checks.
- Object-level authorization tests.
- Membership revocation invalidates sessions/permissions.
- Separate sensitive-document capability.
- Audited privileged access.

### Price manipulation

Attacks:

- Coordinated false quotes.
- One organization creating multiple contributors.
- Unit confusion to create extreme values.
- Compromised source adapter or operator.

Controls:

- Independent-organization diversity.
- Source/contributor weights with caps.
- Unit/product compatibility validation.
- Anomaly and relationship signals.
- Two-person review for exceptional overrides when scale warrants it.
- Reproducible aggregates and public provenance summaries.

### Marketplace fraud

Attacks:

- Fake stock, copied photos or misrepresented agency.
- Fake buyer collecting contact/location data.
- Bait-and-switch after contact reveal.
- Repeated cancellation/no-show.
- Payment-confirmation forgery.

Controls:

- Granular verification and stock checks.
- Contact reveal gates and rate limits.
- Immutable Deal Card and evidence timeline.
- Duplicate media/account signals.
- Outcome-derived reputation and restrictions.
- Clear statement that v1 payment is not guaranteed.

### Malicious uploads

Attacks:

- Malware, polyglot files, decompression bombs.
- Stored XSS through SVG/HTML.
- Metadata privacy leakage.
- Guessable public document URLs.

Controls:

- Type/size allowlists before signed upload.
- Private quarantine bucket/prefix.
- Malware scanning and safe media decoding.
- Strip metadata; never serve user HTML/SVG inline.
- Random opaque object keys and short-lived signed access.

### Injection and application attacks

Controls:

- Parameterized database access.
- Schema validation at trust boundaries.
- Contextual output encoding and strong CSP.
- CSRF protection for cookie sessions.
- SSRF egress restrictions for server fetches.
- Dependency and container scanning.

### Data exfiltration and insider abuse

Controls:

- Least privilege and environment separation.
- No production data in local/test systems.
- Field encryption for high-risk data.
- Audited document views and exports.
- Redacted logs.
- Alert on bulk or unusual access.

### Availability attacks and provider failure

Controls:

- CDN/WAF and rate limits.
- Queue backpressure and bounded retries.
- Circuit breakers/timeouts for external services.
- Stale-but-labelled price fallback.
- Backups and restoration drills.

## 4. Abuse-case review checklist

Before releasing a feature, ask:

- Can it reveal whether a phone number/account exists?
- Can a user infer another party’s exact farm location prematurely?
- Can repeated actions inflate reputation, source diversity or demand?
- Can a stale or rejected price return to public visibility?
- Can a client forge verification, organization or operator context?
- Can a race create duplicate reservations or deals?
- Can an uploaded file execute in another user’s browser?
- Can a notification expose sensitive details on a shared phone?
- Is there a safe reversal, suspension or dispute path?

## 5. Review cadence

- Threat-model review for every material workflow.
- Quarterly access and key review during production.
- Annual independent penetration test, and before platform-managed payments.
- Incident retrospective updates this document and affected ADRs.

