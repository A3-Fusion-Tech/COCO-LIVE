# ADR-006: No platform-held payments in MVP

**Status:** Accepted  
**Date:** 2026-10-01

## Context

Holding or pooling money introduces regulatory, reconciliation, fraud, support and dispute obligations before marketplace liquidity is proven.

## Decision

Payments occur directly between parties in the MVP. LiveCoco records agreed payment terms and optional confirmations/evidence but does not hold funds or promise settlement.

## Consequences

- Lower launch risk and complexity.
- Payment completion is partly self-reported.
- LiveCoco cannot offer escrow protection.
- Future integrated settlement must use an appropriate regulated provider and reviewed legal/tax model.

## Review triggers

- Payment failure becomes a top marketplace blocker.
- Repeat transaction volume justifies provider integration.
- Legal, accounting and operations designs are approved.

