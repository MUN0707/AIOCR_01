-- fiscal_periods に法人税等カラムを追加
alter table public.fiscal_periods
  add column if not exists corporate_tax numeric default 0;
