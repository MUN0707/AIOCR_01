-- 会社情報3カラム + 期首残高JSONB
-- Supabase SQL Editor で一度だけ実行してください

-- 1. clients に会社情報3カラム追加
alter table public.clients
  add column if not exists company_code text,
  add column if not exists legal_name text,
  add column if not exists short_name text;

-- ユーザー内で company_code が一意（NULL は除外: 部分インデックス）
create unique index if not exists clients_user_company_code_uniq
  on public.clients(user_id, company_code)
  where company_code is not null;

-- 2. fiscal_periods に opening_balances JSONB を追加
-- 例: {"繰越利益剰余金": -5898164, "資本金": 100000, ...}
-- 中身は科目名 → 期首残高（円）。資産は正、負債/純資産は正、PL科目は通常含めない。
alter table public.fiscal_periods
  add column if not exists opening_balances jsonb default '{}'::jsonb;
