-- Release D: inspection and logistics partners, FPO aggregation and settlement, media metadata.

alter table deals drop constraint deal_status;
alter table deals add constraint deal_status check (status in ('AGREED','INSPECTION_PENDING','PICKUP_CONFIRMED','DELIVERED','ACCEPTED','DISPUTED','PAYMENT_CONFIRMED','COMPLETED','CANCELLED'));

create table partners (
  key text primary key, doc jsonb not null, updated_at timestamptz not null default now(),
  kind text generated always as (doc->>'kind') stored not null,
  status text generated always as (doc->>'status') stored not null,
  constraint partner_kind check (kind in ('INSPECTION','LOGISTICS')),
  constraint partner_status check (status in ('PENDING','APPROVED','SUSPENDED','REJECTED'))
);

create table inspections (
  key text primary key, doc jsonb not null, updated_at timestamptz not null default now(),
  deal_id text generated always as (doc->>'dealId') stored not null,
  partner_id text generated always as (doc->>'partnerId') stored not null,
  status text generated always as (doc->>'status') stored not null,
  constraint inspection_status check (status in ('REQUESTED','SCHEDULED','COMPLETED','DECIDED','CANCELLED'))
);
create index inspections_deal_idx on inspections (deal_id);
create index inspections_partner_idx on inspections (partner_id, status);
-- Only one inspection may be in flight per deal.
create unique index inspections_one_open_per_deal_uq on inspections (deal_id) where status in ('REQUESTED','SCHEDULED','COMPLETED');

create function guard_inspection() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'inspections cannot be deleted' using errcode = 'integrity_constraint_violation'; end if;
  if old.doc ? 'result' and new.doc->'result' is distinct from old.doc->'result' then
    raise exception 'inspection results are immutable' using errcode = 'integrity_constraint_violation';
  end if;
  return new;
end $$;
create trigger inspections_guard before update or delete on inspections for each row execute function guard_inspection();

create table transport_requests (
  key text primary key, doc jsonb not null, updated_at timestamptz not null default now(),
  deal_id text generated always as (doc->>'dealId') stored not null,
  status text generated always as (doc->>'status') stored not null,
  weight_kg numeric generated always as ((doc->>'weightKg')::numeric) stored not null,
  constraint transport_status check (status in ('OPEN','BOOKED','PICKED_UP','IN_TRANSIT','DELIVERED','CANCELLED')),
  constraint transport_weight_positive check (weight_kg > 0)
);
create index transport_deal_idx on transport_requests (deal_id);

create table transport_quotes (
  key text primary key, doc jsonb not null, updated_at timestamptz not null default now(),
  request_id text generated always as (doc->>'requestId') stored not null,
  partner_id text generated always as (doc->>'partnerId') stored not null,
  status text generated always as (doc->>'status') stored not null,
  price_paise bigint generated always as ((doc->>'pricePaise')::bigint) stored not null,
  constraint quote_price_positive check (price_paise > 0),
  constraint quote_status check (status in ('OFFERED','ACCEPTED','REJECTED','EXPIRED'))
);
create index quotes_request_idx on transport_quotes (request_id);
-- A request is booked with exactly one quote.
create unique index quotes_one_accepted_per_request_uq on transport_quotes (request_id) where status = 'ACCEPTED';

create table member_lots (
  key text primary key, doc jsonb not null, updated_at timestamptz not null default now(),
  organization_id text generated always as (doc->>'organizationId') stored not null,
  status text generated always as (doc->>'status') stored not null,
  quantity numeric generated always as ((doc->>'quantity')::numeric) stored not null,
  constraint member_lot_quantity_positive check (quantity > 0),
  constraint member_lot_status check (status in ('PENDING_REVIEW','APPROVED','REJECTED','AGGREGATED','RELEASED'))
);
create index member_lots_org_idx on member_lots (organization_id, status);

create table aggregate_lots (
  key text primary key, doc jsonb not null, updated_at timestamptz not null default now(),
  organization_id text generated always as (doc->>'organizationId') stored not null,
  sell_lot_id text generated always as (doc->>'sellLotId') stored not null
);
create unique index aggregate_lots_sell_lot_uq on aggregate_lots (sell_lot_id);
-- Member contribution mapping is permanent.
create trigger aggregate_lots_immutable before update or delete on aggregate_lots for each row execute function forbid_change();

create function settlement_line_sum(doc jsonb, field text) returns bigint language sql immutable as $$
  select coalesce(sum((l->>field)::bigint), 0) from jsonb_array_elements(doc->'lines') l
$$;

create table settlements (
  key text primary key, doc jsonb not null, updated_at timestamptz not null default now(),
  deal_id text generated always as (doc->>'dealId') stored not null,
  organization_id text generated always as (doc->>'organizationId') stored not null,
  status text generated always as (doc->>'status') stored not null,
  gross_paise bigint generated always as ((doc->>'grossPaise')::bigint) stored not null,
  deduction_total_paise bigint generated always as ((doc->>'deductionTotalPaise')::bigint) stored not null,
  net_paise bigint generated always as ((doc->>'netPaise')::bigint) stored not null,
  constraint settlement_status check (status in ('DRAFT','APPROVED')),
  constraint settlement_net check (net_paise = gross_paise - deduction_total_paise and net_paise >= 0),
  -- Member lines must add up to the totals exactly (no rounding leakage).
  constraint settlement_lines_balance check (
    settlement_line_sum(doc, 'grossPaise') = gross_paise
    and settlement_line_sum(doc, 'deductionPaise') = deduction_total_paise
    and settlement_line_sum(doc, 'netPaise') = net_paise),
  constraint settlement_approved_has_approver check (status <> 'APPROVED' or doc ? 'approvedBy')
);
create unique index settlements_deal_uq on settlements (deal_id);

create function guard_settlement() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'settlements cannot be deleted' using errcode = 'integrity_constraint_violation'; end if;
  if old.doc->>'status' = 'APPROVED' and new.doc is distinct from old.doc then
    raise exception 'approved settlements are immutable' using errcode = 'integrity_constraint_violation';
  end if;
  if new.doc->'lines' is distinct from old.doc->'lines' or new.doc->'grossPaise' is distinct from old.doc->'grossPaise' then
    raise exception 'settlement amounts cannot change after drafting' using errcode = 'integrity_constraint_violation';
  end if;
  return new;
end $$;
create trigger settlements_guard before update or delete on settlements for each row execute function guard_settlement();

create table media (
  key text primary key, doc jsonb not null, updated_at timestamptz not null default now(),
  owner_id text generated always as (doc->>'ownerId') stored not null,
  status text generated always as (doc->>'status') stored not null,
  purpose text generated always as (doc->>'purpose') stored not null,
  constraint media_status check (status in ('PENDING_UPLOAD','UPLOADED','APPROVED','REJECTED')),
  constraint media_purpose check (purpose in ('LOT_PHOTO','DEAL_EVIDENCE','VERIFICATION_DOCUMENT')),
  constraint media_content_type check (doc->>'contentType' in ('image/jpeg','image/png','image/webp','application/pdf'))
);
create index media_owner_idx on media (owner_id, status);
