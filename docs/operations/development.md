# Development onboarding

## 1. Current state

The monorepo layout, domain rules, PostgreSQL persistence, API, worker and web/PWA are implemented in TypeScript run directly by Node 22. Messaging uses a console adapter and object storage is local disk; see [implementation-status.md](../delivery/implementation-status.md).

## 2. Bootstrap checklist (status)

The first implementation pull request should:

1. ✅ Node ≥ 22 pinned in `package.json` engines and CI.
2. ✅ `apps/web`, `apps/api` and `apps/worker` exist alongside their README context.
3. ✅ Strict shared TypeScript configuration (`tsconfig.base.json`) and a dependency-free lint script.
4. ✅ Local PostgreSQL/PostGIS via `docker compose up -d db` ([ADR-008](../decisions/008-document-store-unit-of-work.md)); ⏳ Redis not yet.
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

- Start PostgreSQL with `docker compose up -d db`; set `DATABASE_URL`.
- `npm run db:migrate` applies migrations; the API also migrates at start and takes a writer lock (a second API process on the same database refuses to start).
- `npm run db:reset` drops and recreates the schema of an explicitly local database only; `npm run seed` adds synthetic actors.
- Tests that need Postgres create and drop an isolated schema per test.

Original guidelines:

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

