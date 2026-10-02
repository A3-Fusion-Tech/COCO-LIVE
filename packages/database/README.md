# Database package

PostgreSQL persistence for LiveCoco. Business decisions stay in the domain/application modules; the database enforces integrity and append-only history. See [ADR-008](../../docs/decisions/008-document-store-unit-of-work.md).

- `migrations/*.sql` — ordered, checksummed migrations (`001_init`, `002_release_d`, `003_outbox`). Applying a changed migration is refused.
- `src/pg.ts` — `PgStore`: migrations, writer lock, load, and `withTransaction` (the per-request unit of work with rollback of in-memory state).
- `src/tracked.ts` — `TrackedMap`, which records which entities a request touched.
- `src/cli.ts` — `npm run db:migrate` and `npm run db:reset` (refuses non-local hosts).

```text
docker compose up -d db
DATABASE_URL=postgresql://livecoco:livecoco@localhost:5432/livecoco npm run db:migrate
```

Tests (`tests/postgres.test.ts`) create an isolated schema per test and drop it afterwards; they are skipped when `DATABASE_URL` is not set.
