# Development onboarding

## 1. Current state

The monorepo layout, domain rules, API, worker and web server are implemented as dependency-free TypeScript run directly by Node 22. State is persisted to a local SQLite file (`LIVECOCO_DB_PATH`, default `.data/livecoco.sqlite`) shared by the API and worker, and messaging uses a console adapter; see [implementation-status.md](../delivery/implementation-status.md).

## 2. Bootstrap checklist (status)

The first implementation pull request should:

1. ✅ Node ≥ 22 pinned in `package.json` engines and CI.
2. ✅ `apps/web`, `apps/api` and `apps/worker` exist alongside their README context.
3. ✅ Strict shared TypeScript configuration (`tsconfig.base.json`) and a dependency-free lint script.
4. ⏳ Local PostgreSQL/PostGIS and Redis environment — not yet; pilot persistence is SQLite ([ADR-007](../decisions/007-sqlite-pilot-persistence.md)). Delete `.data/` to reset local state.
5. ✅ Health (`/healthz` style) and readiness endpoints; ⏳ migrations (no database yet).
6. ✅ Root scripts run real commands.
7. ✅ CI (`.github/workflows/ci.yml`) for lint, typecheck, test and documentation links.
8. ⏳ Secret scanning and dependency review (no dependencies to review yet).

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

