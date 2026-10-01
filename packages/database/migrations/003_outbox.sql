-- Transactional outbox (ADR-004): notifications are queued in the same transaction as the state change.
create table outbox (
  key text primary key, doc jsonb not null, updated_at timestamptz not null default now(),
  user_id text generated always as (doc->>'userId') stored not null,
  status text generated always as (doc->>'status') stored not null,
  next_attempt_at text generated always as (doc->>'nextAttemptAt') stored not null,
  attempts int generated always as ((doc->>'attempts')::int) stored not null,
  constraint outbox_status check (status in ('PENDING','LEASED','SENT','DEAD')),
  constraint outbox_attempts check (attempts >= 0 and attempts <= 5)
);
create index outbox_due_idx on outbox (next_attempt_at) where status in ('PENDING','LEASED');

create function guard_outbox() returns trigger language plpgsql as $$
begin
  if old.doc->>'status' in ('SENT','DEAD') and new.doc->>'status' is distinct from old.doc->>'status' then
    raise exception 'delivered or dead outbox items are final' using errcode = 'integrity_constraint_violation';
  end if;
  if new.doc->'data' is distinct from old.doc->'data' or new.doc->'template' is distinct from old.doc->'template' or new.doc->'userId' is distinct from old.doc->'userId' then
    raise exception 'outbox payloads are immutable' using errcode = 'integrity_constraint_violation';
  end if;
  return new;
end $$;
create trigger outbox_guard before update on outbox for each row execute function guard_outbox();
