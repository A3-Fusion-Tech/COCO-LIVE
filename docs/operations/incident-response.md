# Incident response

## 1. Severity guide

### SEV-1

- Widespread unauthorized access or sensitive-data exposure.
- Incorrect deal acceptance/allocation affecting multiple transactions.
- Compromised privileged account or signing/encryption key.
- Materially manipulated public prices causing ongoing harm.

### SEV-2

- Major authenticated workflow unavailable.
- Notification or source failure materially affecting operations.
- Isolated authorization weakness with limited exposure.
- Repeated duplicate deals/messages requiring intervention.

### SEV-3

- Degraded non-critical feature.
- Contained data-quality issue with safe fallback.
- Minor operational tooling failure.

## 2. Response sequence

1. Acknowledge and assign incident lead.
2. Preserve evidence and correlation IDs.
3. Contain harm: disable source, endpoint, account, integration or feature flag as appropriate.
4. Assess affected users, data, deals and time window.
5. Restore safe service or clearly degraded behavior.
6. Determine notification/legal escalation with authorized leadership/counsel.
7. Monitor recovery.
8. Produce a blameless review with concrete corrective actions.

## 3. Safety rules

- Do not delete evidence during response.
- Do not rotate keys without preserving what is needed for investigation and planning dependent restarts.
- Do not publish unverified causes or affected counts.
- Do not expose fraud-detection detail in public communication.
- Do not restore price publication until provenance and calculation are verified.

## 4. Incident record

- Severity and status.
- Detection source.
- Timeline in IST and UTC.
- Systems/data/users affected.
- Containment and recovery actions.
- Communications.
- Root cause and contributing factors.
- Corrective owners and due dates.
- Documentation/ADR/test updates.

