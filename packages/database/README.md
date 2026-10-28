# Database package

PostgreSQL persistence for LiveCoco. Business decisions stay in the domain/application modules; the database enforces integrity and append-only history. See [ADR-008](../../docs/decisions/008-document-store-unit-of-work.md) and [ADR-010](../../docs/decisions/010-stateless-services-row-locked-units-of-work.md).

- `migrations/*.sql` — ordered, checksummed migrations (`001_init` … `005_price_history_documents`). Applying a changed migration is refused.
- `src/store.ts` — `Tx`, the unit of work: identity map, `get`/`find` (JSON containment), explicit `put`/`delete`/`append`, one flush at commit; `runUnitOfWork` retries on conflicts.
- `src/pg.ts` — `PgStore`: one READ COMMITTED transaction per unit of work, rows locked in write units, and migrations.
- `src/memory.ts` — `MemoryStore`: the same interface in process, for unit tests and database-less development.
- `src/cli.ts` — `npm run db:migrate` and `npm run db:reset` (refuses non-local hosts).

```text
docker compose up -d db
DATABASE_URL=postgresql://livecoco:livecoco@localhost:5432/livecoco npm run db:migrate
```

Tests (`tests/postgres.test.ts`) create an isolated schema per test and drop it afterwards; they are skipped when `DATABASE_URL` is not set.
