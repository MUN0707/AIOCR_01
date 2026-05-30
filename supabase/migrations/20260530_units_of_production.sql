-- 生産高比例法 (units_of_production) 対応
-- fixed_assets に総見込生産量・単位を追加し、月別生産量テーブルを新設する。

-- 1. fixed_assets: 総見込生産量と単位
alter table public.fixed_assets
  add column if not exists total_production numeric,
  add column if not exists production_unit text;

-- 2. asset_monthly_production: 資産ごとの月別生産量
create table if not exists public.asset_monthly_production (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id uuid references public.clients(id) on delete cascade,
  asset_id uuid not null references public.fixed_assets(id) on delete cascade,
  year int not null,
  month int not null check (month between 1 and 12),
  quantity numeric not null default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_asset_monthly_production_asset
  on public.asset_monthly_production(asset_id);
create index if not exists idx_asset_monthly_production_user
  on public.asset_monthly_production(user_id);
create unique index if not exists asset_monthly_production_uniq
  on public.asset_monthly_production(asset_id, year, month);

alter table public.asset_monthly_production enable row level security;
drop policy if exists "asset_monthly_production_owner_all" on public.asset_monthly_production;
create policy "asset_monthly_production_owner_all"
  on public.asset_monthly_production
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
