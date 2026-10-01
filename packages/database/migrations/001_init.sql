-- LiveCoco initial schema.
-- Each aggregate is stored as a JSONB document (`doc`) keyed by its opaque id. Columns used for
-- lookups, uniqueness and integrity are GENERATED from the document so they can never drift from it.
-- Business decisions stay in the application; the database enforces integrity and append-only history.

create table users (
  key text primary key, doc jsonb not null, updated_at timestamptz not null default now(),
  phone text generated always as (doc->>'phone') stored not null,
  suspended boolean generated always as ((doc->>'suspended')::boolean) stored not null,
  constraint users_phone_e164 check (phone ~ '^\+91[6-9][0-9]{9}$')
);
create unique index users_phone_uq on users (phone);

create table sessions (
  key text primary key, doc jsonb not null, updated_at timestamptz not null default now(),
  user_id text generated always as (doc->>'userId') stored not null,
  revoked boolean generated always as ((doc->>'revoked')::boolean) stored not null
);
create index sessions_user_idx on sessions (user_id) where not revoked;

create table otps (key text primary key, doc jsonb not null, updated_at timestamptz not null default now());
create table otp_requests (key text primary key, doc jsonb not null, updated_at timestamptz not null default now());
create table organizations (key text primary key, doc jsonb not null, updated_at timestamptz not null default now());

create table verification_claims (
  key text primary key, doc jsonb not null, updated_at timestamptz not null default now(),
  user_id text generated always as (doc->>'userId') stored not null,
  claim_type text generated always as (doc->>'type') stored not null,
  status text generated always as (doc->>'status') stored not null,
  constraint claim_status check (status in ('NOT_STARTED','EVIDENCE_REQUESTED','SUBMITTED','IN_REVIEW','NEEDS_MORE_INFORMATION','APPROVED','REJECTED','EXPIRED','REVOKED'))
);
create index claims_user_idx on verification_claims (user_id, claim_type, status);

create table evidence (
  key text primary key, doc jsonb not null, updated_at timestamptz not null default now(),
  owner_id text generated always as (doc->>'ownerId') stored not null,
  deal_id text generated always as (doc->>'dealId') stored
);
create index evidence_deal_idx on evidence (deal_id) where deal_id is not null;

create table raw_records (
  key text primary key, doc jsonb not null, updated_at timestamptz not null default now(),
  source text generated always as (doc->>'source') stored not null,
  payload_hash text generated always as (doc->>'hash') stored not null
);
create unique index raw_records_source_hash_uq on raw_records (source, payload_hash);

create table price_observations (
  key text primary key, doc jsonb not null, updated_at timestamptz not null default now(),
  product_id text generated always as (doc->>'productId') stored not null,
  market_id text generated always as (doc->>'marketId') stored not null,
  unit text generated always as (doc->>'unit') stored not null,
  state text generated always as (doc->>'state') stored not null,
  source_class text generated always as (doc->>'sourceClass') stored not null,
  organization_id text generated always as (doc->>'organizationId') stored not null,
  observed_at text generated always as (doc->>'observedAt') stored not null,
  low_paise bigint generated always as ((doc->>'lowPaise')::bigint) stored not null,
  high_paise bigint generated always as ((doc->>'highPaise')::bigint) stored not null,
  constraint obs_money_nonneg check (low_paise >= 0 and high_paise >= 0),
  constraint obs_low_le_high check (low_paise <= high_paise),
  constraint obs_state check (state in ('RECEIVED','NORMALIZED','ELIGIBLE','PUBLISHED','NEEDS_REVIEW','REJECTED','SUPERSEDED','WITHDRAWN'))
);
create index obs_bucket_idx on price_observations (product_id, market_id, unit, state, observed_at);

create table price_aggregates (key text primary key, doc jsonb not null, updated_at timestamptz not null default now());
create table source_health (key text primary key, doc jsonb not null, updated_at timestamptz not null default now());

create table alert_subscriptions (
  key text primary key, doc jsonb not null, updated_at timestamptz not null default now(),
  user_id text generated always as (doc->>'userId') stored not null,
  status text generated always as (doc->>'status') stored not null,
  constraint alert_status check (status in ('ACTIVE','PAUSED','CANCELLED')),
  constraint alert_consent check (doc ? 'consentAt')
);
create index alerts_user_idx on alert_subscriptions (user_id);

create table ops_queue (
  key text primary key, doc jsonb not null, updated_at timestamptz not null default now(),
  queue text generated always as (doc->>'queue') stored not null,
  status text generated always as (doc->>'status') stored not null,
  priority int generated always as ((doc->>'priority')::int) stored not null
);
create index ops_queue_open_idx on ops_queue (queue, priority) where status = 'OPEN';

create table sell_lots (
  key text primary key, doc jsonb not null, updated_at timestamptz not null default now(),
  seller_id text generated always as (doc->>'sellerId') stored not null,
  product_id text generated always as (doc->>'productId') stored not null,
  status text generated always as (doc->>'status') stored not null,
  expires_at text generated always as (doc->>'expiresAt') stored not null,
  quantity_total numeric generated always as ((doc->>'quantityTotal')::numeric) stored not null,
  quantity_reserved numeric generated always as ((doc->>'quantityReserved')::numeric) stored not null,
  constraint lot_never_oversold check (quantity_reserved >= 0 and quantity_reserved <= quantity_total),
  constraint lot_status check (status in ('DRAFT','PENDING_REVIEW','ACTIVE','RESERVED','SOLD','EXPIRED','WITHDRAWN','SUSPENDED'))
);
create index lots_discover_idx on sell_lots (product_id, status, expires_at);

create table buy_requirements (
  key text primary key, doc jsonb not null, updated_at timestamptz not null default now(),
  buyer_id text generated always as (doc->>'buyerId') stored not null,
  product_id text generated always as (doc->>'productId') stored not null,
  status text generated always as (doc->>'status') stored not null,
  constraint req_status check (status in ('DRAFT','ACTIVE','FILLED','EXPIRED','CLOSED','SUSPENDED'))
);
create index reqs_buyer_idx on buy_requirements (buyer_id, status);

create table recurrence_templates (key text primary key, doc jsonb not null, updated_at timestamptz not null default now());
create table negotiation_threads (
  key text primary key, doc jsonb not null, updated_at timestamptz not null default now(),
  sell_lot_id text generated always as (doc->>'sellLotId') stored not null,
  seller_id text generated always as (doc->>'sellerId') stored not null,
  buyer_id text generated always as (doc->>'buyerId') stored not null
);
create unique index threads_lot_buyer_uq on negotiation_threads (sell_lot_id, buyer_id);

create table offers (
  key text primary key, doc jsonb not null, updated_at timestamptz not null default now(),
  thread_id text generated always as (doc->>'threadId') stored not null,
  sell_lot_id text generated always as (doc->>'sellLotId') stored not null,
  seller_id text generated always as (doc->>'sellerId') stored not null,
  buyer_id text generated always as (doc->>'buyerId') stored not null,
  status text generated always as (doc->>'status') stored not null,
  constraint offer_status check (status in ('ACTIVE','ACCEPTED','REJECTED','COUNTERED','EXPIRED','WITHDRAWN','INVALIDATED'))
);
-- A negotiation is a linear chain: at most one directly-acceptable offer per thread.
create unique index offers_one_active_per_thread_uq on offers (thread_id) where status = 'ACTIVE';
create index offers_party_idx on offers (seller_id, buyer_id);

create table deals (
  key text primary key, doc jsonb not null, updated_at timestamptz not null default now(),
  seller_id text generated always as (doc->>'sellerId') stored not null,
  buyer_id text generated always as (doc->>'buyerId') stored not null,
  sell_lot_id text generated always as (doc->>'sellLotId') stored not null,
  status text generated always as (doc->>'status') stored not null,
  constraint deal_has_card check (jsonb_array_length(doc->'cards') >= 1),
  constraint deal_status check (status in ('AGREED','PICKUP_CONFIRMED','DELIVERED','ACCEPTED','DISPUTED','PAYMENT_CONFIRMED','COMPLETED','CANCELLED'))
);
create index deals_party_idx on deals (seller_id, buyer_id);

create table disputes (
  key text primary key, doc jsonb not null, updated_at timestamptz not null default now(),
  deal_id text generated always as (doc->>'dealId') stored not null,
  status text generated always as (doc->>'status') stored not null,
  constraint dispute_status check (status in ('OPEN','AWAITING_RESPONSE','UNDER_REVIEW','RESOLVED')),
  constraint dispute_resolved_has_resolution check (status <> 'RESOLVED' or doc ? 'resolution')
);
create unique index disputes_deal_uq on disputes (deal_id);

create table dispute_prior_status (key text primary key, doc jsonb not null, updated_at timestamptz not null default now());
create table idempotency_keys (key text primary key, doc jsonb not null, updated_at timestamptz not null default now());

-- Append-only logs ----------------------------------------------------------------------------
create table audit_log (idx integer primary key, doc jsonb not null, created_at timestamptz not null default now());
create table notifications (idx integer primary key, doc jsonb not null, created_at timestamptz not null default now());
create table reputation_events (idx integer primary key, doc jsonb not null, created_at timestamptz not null default now());
create table contact_reveals (idx integer primary key, doc jsonb not null, created_at timestamptz not null default now());
create table user_reports (idx integer primary key, doc jsonb not null, created_at timestamptz not null default now());

create function forbid_change() returns trigger language plpgsql as $$
begin
  raise exception '% is append-only (% not allowed)', tg_table_name, tg_op using errcode = 'integrity_constraint_violation';
end $$;

create trigger audit_log_append_only before update or delete on audit_log for each row execute function forbid_change();
create trigger notifications_append_only before update or delete on notifications for each row execute function forbid_change();
create trigger reputation_append_only before update or delete on reputation_events for each row execute function forbid_change();
create trigger reveals_append_only before update or delete on contact_reveals for each row execute function forbid_change();
create trigger reports_append_only before update or delete on user_reports for each row execute function forbid_change();
-- Raw source payloads are preserved exactly as received.
create trigger raw_records_immutable before update or delete on raw_records for each row execute function forbid_change();

-- Offers: commercial terms and provenance never change after creation.
create function guard_offer() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'offers cannot be deleted' using errcode = 'integrity_constraint_violation'; end if;
  if new.doc->'terms' is distinct from old.doc->'terms'
     or new.doc->'expiresAt' is distinct from old.doc->'expiresAt'
     or new.doc->'revision' is distinct from old.doc->'revision'
     or new.doc->'previousOfferId' is distinct from old.doc->'previousOfferId'
     or new.doc->'createdByPartyId' is distinct from old.doc->'createdByPartyId' then
    raise exception 'offer terms are immutable; create a counter-offer revision' using errcode = 'integrity_constraint_violation';
  end if;
  return new;
end $$;
create trigger offers_guard before update or delete on offers for each row execute function guard_offer();

-- Price observations: prices and observation time never change; corrections create new versions.
create function guard_observation() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'observations cannot be deleted' using errcode = 'integrity_constraint_violation'; end if;
  if new.doc->'lowPaise' is distinct from old.doc->'lowPaise' or new.doc->'highPaise' is distinct from old.doc->'highPaise'
     or new.doc->'referencePaise' is distinct from old.doc->'referencePaise' or new.doc->'observedAt' is distinct from old.doc->'observedAt'
     or new.doc->'productId' is distinct from old.doc->'productId' or new.doc->'unit' is distinct from old.doc->'unit' then
    raise exception 'observation values are immutable; supersede with a correction' using errcode = 'integrity_constraint_violation';
  end if;
  return new;
end $$;
create trigger observations_guard before update or delete on price_observations for each row execute function guard_observation();

-- Deals: Deal Card revisions and the event timeline only ever grow.
create function guard_deal() returns trigger language plpgsql as $$
declare i int;
begin
  if tg_op = 'DELETE' then raise exception 'deals cannot be deleted' using errcode = 'integrity_constraint_violation'; end if;
  if jsonb_array_length(new.doc->'cards') < jsonb_array_length(old.doc->'cards')
     or jsonb_array_length(new.doc->'events') < jsonb_array_length(old.doc->'events') then
    raise exception 'deal history cannot shrink' using errcode = 'integrity_constraint_violation';
  end if;
  for i in 0 .. jsonb_array_length(old.doc->'cards') - 1 loop
    if new.doc->'cards'->i is distinct from old.doc->'cards'->i then
      raise exception 'Deal Card revisions are immutable' using errcode = 'integrity_constraint_violation';
    end if;
  end loop;
  for i in 0 .. jsonb_array_length(old.doc->'events') - 1 loop
    if new.doc->'events'->i is distinct from old.doc->'events'->i then
      raise exception 'deal events are append-only' using errcode = 'integrity_constraint_violation';
    end if;
  end loop;
  return new;
end $$;
create trigger deals_guard before update or delete on deals for each row execute function guard_deal();

-- Disputes: a resolution, once recorded, is final.
create function guard_dispute() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'disputes cannot be deleted' using errcode = 'integrity_constraint_violation'; end if;
  if old.doc->>'status' = 'RESOLVED' and new.doc is distinct from old.doc then
    raise exception 'resolved disputes are final' using errcode = 'integrity_constraint_violation';
  end if;
  return new;
end $$;
create trigger disputes_guard before update or delete on disputes for each row execute function guard_dispute();
