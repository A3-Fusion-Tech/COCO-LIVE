# ADR-002: Preserve raw price provenance

**Status:** Accepted  
**Date:** 2026-10-01

## Context

Agricultural price feeds may be delayed, corrected or inconsistently named. LiveCoco must explain public prices and reprocess history when mappings improve.

## Decision

Persist every retrieved source record or authenticated contributor submission before normalization. Normalized observations reference immutable raw records, parser versions and correction history.

## Consequences

- Published prices are auditable and reproducible.
- Historical reprocessing is possible.
- Storage usage increases.
- Raw payloads require retention, access and secret/PII review.

## Alternatives considered

- Store normalized rows only: rejected because source disputes cannot be reconstructed.
- Store raw logs outside the domain database only: rejected because log retention and queryability are insufficient for provenance.

## Review triggers

- Source licensing restricts retention.
- Raw records contain unexpected personal/sensitive data.
- Data volume requires archival-tier storage.

