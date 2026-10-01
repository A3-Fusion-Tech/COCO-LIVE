# Database package

Owns persistence. Business decisions remain in the domain/application modules rather than database triggers, except for integrity constraints and append-only protections.

## Current: SQLite pilot store

`src/index.ts` exports `SqliteStore`, which keeps every `Platform` collection listed in `PERSISTED_COLLECTIONS` as JSON rows in one SQLite file ([ADR-007](../../docs/decisions/007-sqlite-pilot-persistence.md)).

- `attach(platform)` writes defaults on first run, otherwise loads saved state.
- `unitOfWork(platform, fn)` runs `fn` under an exclusive write lock, reloads state committed by another process first, then writes only changed rows.
- A test fails if `Platform` gains a `Map` or array that is not listed in `PERSISTED_COLLECTIONS`.

## Next: PostgreSQL

Schema, forward-only migrations, repositories and transaction helpers for PostgreSQL/PostGIS replace this store before running more than one API instance.
