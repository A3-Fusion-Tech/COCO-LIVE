# Development onboarding

## 1. Current state

The repository is documentation-first. The monorepo layout, contracts and domain rules are defined, but application frameworks and dependencies have not been generated.

## 2. First bootstrap change

The first implementation pull request should:

1. Pin Node and pnpm versions for contributors and CI.
2. Generate `apps/web`, `apps/api` and `apps/worker` without deleting their README context.
3. Establish shared lint, format and TypeScript configuration.
4. Add a local PostgreSQL/PostGIS and Redis development environment.
5. Add migrations and a health/readiness endpoint.
6. Replace placeholder root scripts with working recursive commands.
7. Add CI for install, lint, typecheck, test, build and documentation links.
8. Add secret scanning and dependency review.

## 3. Local configuration

- Copy `.env.example` into an ignored local file.
- Use only local/sandbox credentials.
- Register a personal data.gov.in API key when implementing the official adapter; do not commit it.
- Console/no-op messaging adapters are the default locally.

## 4. Database workflow

- Migrations are source-controlled and applied automatically to disposable local/test databases.
- Seed only canonical catalog and synthetic development actors.
- Provide a deterministic reset script targeting only the explicit local database/container.
- Tests create isolated schemas/databases and clean them without touching developer data.

## 5. Definition of done

- Acceptance criteria implemented.
- Unit/integration/end-to-end tests as appropriate.
- Authorization tests for protected resources.
- Tamil and English review for visible copy.
- Observability added for important failure modes.
- Migration, configuration and operational impact documented.
- ADR updated/added when decision rules require it.
- No broken local documentation links.

## 6. Review order

For domain-heavy changes, reviewers should examine:

1. Domain invariant and state transition.
2. Authorization and privacy boundary.
3. Transaction/concurrency behavior.
4. API contract.
5. Persistence/migration.
6. UI and localization.
7. Observability and operations.

