-- 固定資産 / 減価償却 機能
-- Supabase SQL Editor で一度だけ実行してください

-- 1. accounts に fixed_asset_type を追加（tangible/intangible/deferred/non_depreciable）
alter table public.accounts
  add column if not exists fixed_asset_type text;

-- 既知の科目に自動割当（初回のみ）
update public.accounts set fixed_asset_type = 'tangible'
  where fixed_asset_type is null and name in ('建物','構築物','機械装置','車両運搬具','工具器具備品','器具備品','備品');
update public.accounts set fixed_asset_type = 'intangible'
  where fixed_asset_type is null and name in ('ソフトウェア','特許権','商標権','のれん');
update public.accounts set fixed_asset_type = 'deferred'
  where fixed_asset_type is null and name in ('創立費','開業費','開発費','社債発行費','株式交付費');
update public.accounts set fixed_asset_type = 'non_depreciable'
  where fixed_asset_type is null and name in ('土地','投資有価証券','敷金','差入保証金','長期貸付金');

-- 2. fixed_assets: 固定資産マスター
create table if not exists public.fixed_assets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id uuid references public.clients(id) on delete cascade,
  asset_number int not null,
  category text not null check (category in ('tangible','intangible','deferred')),
  name text not null,
  account_name text not null,
  acquisition_date date,
  depreciation_start_date date,
  acquisition_cost numeric not null default 0,
  residual_value numeric not null default 0,
  useful_life_years int,
  method text not null default 'straight_line' check (method in ('straight_line','declining_balance','units_of_production')),
  last_depreciated_through text,
  status text not null default 'active' check (status in ('pending','active','disposed')),
  note text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_fixed_assets_user on public.fixed_assets(user_id);
create index if not exists idx_fixed_assets_client on public.fixed_assets(client_id);
create unique index if not exists fixed_assets_user_asset_number_uniq
  on public.fixed_assets(user_id, coalesce(client_id, '00000000-0000-0000-0000-000000000000'::uuid), asset_number);

alter table public.fixed_assets enable row level security;
drop policy if exists "fixed_assets_owner_all" on public.fixed_assets;
create policy "fixed_assets_owner_all"
  on public.fixed_assets
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- 3. accounting_rules: 会計ルール（履歴管理）
-- effective_from_date 以降で有効。デフォルト1件、変更時に追加レコード。
create table if not exists public.accounting_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id uuid references public.clients(id) on delete cascade,
  effective_from_date date not null,
  depreciation_method_tangible text not null default 'indirect' check (depreciation_method_tangible in ('indirect','direct')),
  depreciation_method_intangible text not null default 'direct' check (depreciation_method_intangible in ('indirect','direct')),
  depreciation_method_deferred text not null default 'direct' check (depreciation_method_deferred in ('indirect','direct')),
  depreciation_timing text not null default 'annual' check (depreciation_timing in ('monthly','annual')),
  created_at timestamptz default now()
);

create index if not exists idx_accounting_rules_user on public.accounting_rules(user_id);
create index if not exists idx_accounting_rules_client on public.accounting_rules(client_id);

alter table public.accounting_rules enable row level security;
drop policy if exists "accounting_rules_owner_all" on public.accounting_rules;
create policy "accounting_rules_owner_all"
  on public.accounting_rules
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- 4. journal_entries に減価償却との紐付けカラムを追加
alter table public.journal_entries
  add column if not exists source_fixed_asset_id uuid references public.fixed_assets(id) on delete set null,
  add column if not exists depreciation_period text; -- YYYY-MM (月次) or YYYY (年次)

create index if not exists idx_journal_entries_source_fixed_asset
  on public.journal_entries(source_fixed_asset_id);
