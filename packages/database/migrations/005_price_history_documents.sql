-- Price aggregate history was stored as a bare JSON array, which JSON containment queries (doc @> '{}') never
-- match. Each bucket becomes an object document: { bucket, history: [...] }.
update price_aggregates
set doc = jsonb_build_object('bucket', key, 'history', doc)
where jsonb_typeof(doc) = 'array';
alter table price_aggregates add constraint price_aggregates_is_history check (jsonb_typeof(doc) = 'object' and doc ? 'history');
