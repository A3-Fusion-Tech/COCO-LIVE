# Security Policy

LiveCoco handles identity, contact, location, commercial and transaction evidence. Security defects can expose people as well as businesses.

## Reporting a vulnerability

This repository does not yet have a public security mailbox. Until one is configured, report vulnerabilities privately to the repository owner. Do not include real personal data beyond the minimum needed to reproduce the issue.

Do not create a public issue for:

- Authentication or authorization bypass.
- OTP abuse.
- Exposure of phone numbers or precise farm locations.
- Verification-document exposure.
- Price manipulation or contributor-collusion weaknesses.
- Payment, settlement or invoice weaknesses.
- Stored cross-site scripting through listings or evidence.
- Unsafe media/file processing.

## Supported versions

The application is pre-release. Once production releases begin, this document will list supported branches and response targets.

## Baseline requirements

- No production secrets in source control.
- No real user data in non-production environments.
- Server-side authorization for every protected operation.
- Encryption in transit and at rest.
- Private document storage with short-lived signed access.
- Rate limits for OTP, login, listing, offer and contact-reveal actions.
- Audit records for privileged and commercially material actions.
- Dependency and container scanning in CI.
- Tested backups and recovery procedures.

