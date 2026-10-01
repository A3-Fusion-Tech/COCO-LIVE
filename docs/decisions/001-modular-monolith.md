# ADR-001: Modular monolith

**Status:** Accepted  
**Date:** 2026-10-01

## Context

The business workflow is still being validated. Prices, listings, allocation, offers and deals have strong transactional relationships. The initial team and traffic do not justify distributed ownership.

## Decision

Implement one modular API application backed by one PostgreSQL database, plus separate web and worker deployables. Enforce module ownership through code boundaries and application interfaces.

## Consequences

- Cross-domain transactions remain reliable and understandable.
- Deployment and observability are simpler.
- Modules can be extracted later, but separation is not free; contracts and ownership discipline are required now.
- Database access must not become an excuse for cross-module table mutation.

## Alternatives considered

- Microservices: rejected due to distributed transaction, deployment and operational cost.
- Single unstructured application: rejected because domain boundaries would erode.
- Serverless functions per endpoint: rejected as the primary model because workflows and background processing need coherent ownership and transactions.

## Review triggers

- A module requires materially different scaling.
- Independent teams need separate release ownership.
- Regulatory isolation requires distinct data/control boundaries.
- Deployments repeatedly affect unrelated high-availability paths.

