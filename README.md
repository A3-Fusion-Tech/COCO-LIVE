# LiveCoco

LiveCoco is a Tamil Nadu-focused coconut price-intelligence and verified B2B marketplace platform. It is designed to make coconut prices explainable and trade terms explicit before connecting farmers, FPOs, traders, processors and institutional buyers.

The product begins with the Pollachi–Anaimalai–Udumalpet coconut belt and four products:

- Mature coconut
- Tender coconut
- Milling copra
- Ball copra

## Product promise

> Trusted coconut prices, verified buyers, and clear trade terms.

LiveCoco does not present one context-free “live price.” Every published price must identify the product, grade, unit, market stage, location, commercial terms, source and observation time.

## Repository status

The documented system is implemented as a dependency-free TypeScript reference implementation covering Release A (price board), Release B (assisted leads) and Release C (structured deals) per [docs/delivery/roadmap.md](./docs/delivery/roadmap.md). See [docs/delivery/implementation-status.md](./docs/delivery/implementation-status.md) for exactly what exists, what is simulated (in-memory storage, console messaging) and what remains before production.

## Repository map

```text
live-coco/
  apps/
    web/                 Public prices, marketplace and operations UI
    api/                 Modular application API
    worker/              Ingestion and background processing
  packages/
    contracts/           API schemas and generated clients
    database/            Schema, migrations and repositories
    domain/              Domain policies and state machines
    localization/        Tamil and English catalogs
    observability/       Logging, metrics and tracing helpers
    test-support/        Shared fixtures and test infrastructure
    ui/                  Shared accessible UI components
  docs/
    api/                 API design and error conventions
    decisions/           Architecture decision records
    delivery/            Roadmap and release gates
    domain/              Business concepts and workflows
    operations/          Runbooks and source-health procedures
    product/             Scope, personas and requirements
    security/            Threat model and privacy controls
    testing/             Test strategy
  ARCHITECTURE.md         System-level architecture
  RESEARCH.md             Tamil Nadu market and product research
```

## Start here

1. Read [RESEARCH.md](./RESEARCH.md) for the market evidence and product recommendation.
2. Read [ARCHITECTURE.md](./ARCHITECTURE.md) for the overall technical design.
3. Read [docs/product/requirements.md](./docs/product/requirements.md) for MVP behavior and acceptance criteria.
4. Read [docs/product/mobile-app-flow.md](./docs/product/mobile-app-flow.md) for the screen-by-screen mobile experience.
5. Read [docs/domain/price-intelligence.md](./docs/domain/price-intelligence.md) before implementing any price display.
6. Read [docs/domain/marketplace.md](./docs/domain/marketplace.md) before implementing listings, offers or deals.
7. Review the decisions in [docs/decisions](./docs/decisions/README.md).

## Engineering principles

- Preserve source data before normalizing it.
- Prefer explainable calculations over opaque predictions.
- Store money as integer paise and measured quantities as decimals with explicit units.
- Treat every offer and accepted commercial term as immutable history.
- Separate identity, organization, document and stock verification claims.
- Reveal precise farm/pickup locations only when necessary and authorized.
- Keep critical marketplace actions transactional and jobs idempotent.
- Build Tamil and low-bandwidth behavior as core requirements.
- Avoid platform-held funds until a regulated provider and reviewed operating model exist.

## Local prerequisites

- Node.js 22.18 or newer (runs TypeScript natively; no build step, no runtime dependencies)
- `typescript` and `@types/node` only for `npm run typecheck` (`npm install --no-save typescript @types/node`)

Production hardening (PostgreSQL/PostGIS, Redis queue, object storage, SMS provider) is described in [implementation-status.md](./docs/delivery/implementation-status.md).

## Configuration

Copy `.env.example` to an untracked local environment file once services exist. Production secrets must be stored in the deployment platform’s secret manager, never committed.

## Development workflow

```text
npm run dev          # API on :4000 (OTPs are printed to the console in development)
npm run dev:worker   # ingestion, expiry, alerts (needs DATA_GOV_IN_API_KEY for AGMARKNET)
npm run dev:web      # Tamil/English price pages on :3000 (API_BASE_URL -> API)
npm test             # 40 unit, integration and HTTP tests
npm run lint
npm run typecheck
npm run docs:check
```

Set `OPERATOR_PHONES=+91XXXXXXXXXX` to grant operator capabilities to a development account (operator endpoints still require OTP step-up).

## Documentation ownership

Documentation is part of the product. Changes to price behavior, state transitions, verification claims, public API contracts or security controls require corresponding documentation and, where appropriate, an architecture decision record.

See [CONTRIBUTING.md](./CONTRIBUTING.md) for contribution rules and [SECURITY.md](./SECURITY.md) for vulnerability reporting guidance.

