-- 予算マスタ（科目別・月別）
create table if not exists budgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id uuid references clients(id) on delete cascade,
  account_name text not null,
  year int not null check (year between 2000 and 2100),
  month int not null check (month between 1 and 12),
  amount bigint not null default 0,
  created_at timestamptz not null default now()
);

-- user + client + account + year + month で一意（client_id は null 許容のため coalesce）
create unique index if not exists budgets_unique_idx
  on budgets (user_id, coalesce(client_id, '00000000-0000-0000-0000-000000000000'::uuid), account_name, year, month);

create index if not exists budgets_user_id_idx on budgets (user_id);
create index if not exists budgets_client_id_idx on budgets (client_id);
create index if not exists budgets_year_month_idx on budgets (year, month);
