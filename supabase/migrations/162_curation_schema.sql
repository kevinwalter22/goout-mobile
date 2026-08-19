-- 162_curation_schema.sql
--
-- The curation/blend schema, made reproducible (was staging-direct during the MVP).
-- Idempotent: creates the tables + columns the base mapping (163) and blend (164)
-- read/write. The DATA in editorial_mentions / type_corrections is OPTIONAL — both
-- the mapping and the blend degrade gracefully when they're empty (model + Google
-- is the reproducible core). model_notability itself is created by migration 161.
--
-- ROLLBACK (copy-paste):
--   alter table public.explore_items drop column if exists is_carousel_eligible,
--                                    drop column if exists blended_notability;
--   drop table if exists public.editorial_signal;
--   drop table if exists public.editorial_mentions;
--   drop table if exists public.type_corrections;

-- Editorial mentions (optional booster: name-based best-of guide mentions; re-matches
-- to the catalog by normalized name, so it is catalog-portable if seeded).
create table if not exists public.editorial_mentions (
  id uuid primary key default gen_random_uuid(),
  place_name_raw text,
  normalized_name text,
  geo_hint text,
  list_slug text,
  source_name text,
  source_url text,
  year integer,
  region_id uuid references public.region(id),
  matched_item_id uuid references public.explore_items(id) on delete set null,
  provenance jsonb,
  extracted_at timestamptz default now()
);
create index if not exists idx_editorial_mentions_norm on public.editorial_mentions(normalized_name);
create index if not exists idx_editorial_mentions_match on public.editorial_mentions(matched_item_id);

-- Editorial signal (per-item rollup consumed by the blend).
create table if not exists public.editorial_signal (
  item_id uuid primary key references public.explore_items(id) on delete cascade,
  bestof_count integer default 0,
  cross_source_count integer default 0,
  google_operating boolean default false,
  updated_at timestamptz default now()
);

-- Type corrections (optional override layer: an applied model_intent wins over the
-- Google-type mapping; empty => the base mapping's generic rules apply unchanged).
create table if not exists public.type_corrections (
  item_id uuid primary key references public.explore_items(id) on delete cascade,
  title text,
  google_sub text,
  current_intent text,
  model_intent text,
  confidence numeric,
  reason text,
  applied boolean default false,
  created_at timestamptz default now()
);

-- The two curation columns the blend writes onto explore_items.
alter table public.explore_items add column if not exists is_carousel_eligible boolean;
alter table public.explore_items add column if not exists blended_notability numeric;

-- Service-role only (like the other curation tables).
alter table public.editorial_mentions enable row level security;
alter table public.editorial_signal enable row level security;
alter table public.type_corrections enable row level security;
grant all on public.editorial_mentions, public.editorial_signal, public.type_corrections to service_role;
