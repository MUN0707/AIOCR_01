-- 部門マスタ
create table if not exists departments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id uuid references clients(id) on delete cascade,
  name text not null,
  code text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create unique index if not exists departments_user_client_name_idx
  on departments (user_id, client_id, name)
  where client_id is not null;

create unique index if not exists departments_user_null_client_name_idx
  on departments (user_id, name)
  where client_id is null;

create index if not exists departments_user_id_idx on departments (user_id);
create index if not exists departments_client_id_idx on departments (client_id);

-- 仕訳に部門カラム追加
alter table journal_entries
  add column if not exists department_id uuid references departments(id) on delete set null;

create index if not exists journal_entries_department_id_idx on journal_entries (department_id);
