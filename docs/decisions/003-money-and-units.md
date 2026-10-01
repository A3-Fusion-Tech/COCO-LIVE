# ADR-003: Explicit money and unit semantics

**Status:** Accepted  
**Date:** 2026-10-01

## Context

Coconut products trade per nut, kilogram, quintal, tonne, litre and load. Incorrect conversions can mislead users and create commercial disputes.

## Decision

Store INR money as integer paise. Store quantities as decimal values with explicit units. Preserve original price/unit. Permit conversions only within compatible dimensions; count-to-weight conversion requires observed lot-specific evidence.

## Consequences

- Arithmetic is deterministic.
- APIs are more verbose but safer.
- UI formatting remains locale-specific.
- “Convenient” generic average-weight conversion is prohibited.

## Alternatives considered

- Floating-point rupees: rejected due to rounding ambiguity.
- Normalize everything to kilograms: rejected because count-based coconut markets are real and lot weights vary.

## Review triggers

- Multi-currency trade becomes a supported product requirement.
- A regulated unit/rounding standard imposes additional rules.

