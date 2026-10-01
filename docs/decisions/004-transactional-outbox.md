# ADR-004: Transactional outbox

**Status:** Accepted  
**Date:** 2026-10-01

## Context

Commercial state changes must reliably trigger notifications, matching and downstream processing without sending external messages inside database transactions.

## Decision

Write domain state and an outbox event in the same PostgreSQL transaction. Workers claim and process outbox records idempotently with retry and dead-letter handling.

## Consequences

- No acknowledged state change is lost between database commit and queue publication.
- Consumers must tolerate duplicates.
- Outbox cleanup and lag monitoring are required.

## Alternatives considered

- Direct queue publish after commit: rejected due to the failure gap.
- Distributed transactions: rejected as unnecessary and poorly supported across providers.

## Review triggers

- Event volume overwhelms the database pattern.
- A change-data-capture platform becomes operationally justified.

