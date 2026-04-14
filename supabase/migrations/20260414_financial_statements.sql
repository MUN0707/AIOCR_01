-- 決算書機能: 勘定科目に sub_category/display_order 追加 + fiscal_periods 新規作成
-- Supabase SQL Editor で一度だけ実行してください

-- 1. accounts に中区分・表示順カラムを追加
alter table public.accounts
  add column if not exists sub_category text,
  add column if not exists display_order int default 0;

-- 2. 既存勘定科目に sub_category を自動割当（初回のみ）
update public.accounts set sub_category = '流動資産'
  where sub_category is null and name in ('現金','小口現金','普通預金','当座預金','定期預金','売掛金','受取手形','前払費用','立替金','仮払金','棚卸資産','商品','製品','原材料','貯蔵品');

update public.accounts set sub_category = '固定資産'
  where sub_category is null and name in ('建物','構築物','機械装置','車両運搬具','工具器具備品','土地','ソフトウェア','投資有価証券','敷金','差入保証金','長期貸付金');

update public.accounts set sub_category = '流動負債'
  where sub_category is null and name in ('買掛金','未払金','未払費用','未払法人税等','未払消費税等','預り金','短期借入金','前受金','仮受消費税');

update public.accounts set sub_category = '固定負債'
  where sub_category is null and name in ('長期借入金','社債','退職給付引当金');

update public.accounts set sub_category = '純資産'
  where sub_category is null and name in ('資本金','資本準備金','利益準備金','繰越利益剰余金');

update public.accounts set sub_category = '売上高'
  where sub_category is null and name in ('売上高','売上');

update public.accounts set sub_category = '売上原価'
  where sub_category is null and name in ('仕入高','仕入','期首商品棚卸高','期末商品棚卸高','外注費','業務委託費');

update public.accounts set sub_category = '販管費'
  where sub_category is null and name in ('支払手数料','通信費','旅費交通費','消耗品費','会議費','接待交際費','広告宣伝費','水道光熱費','租税公課','雑費','地代家賃','給料手当','役員報酬','法定福利費','福利厚生費','減価償却費','保険料','賃借料','修繕費','新聞図書費','研修費','車両費','支払報酬');

update public.accounts set sub_category = '営業外収益'
  where sub_category is null and name in ('受取利息','受取配当金','雑収入');

update public.accounts set sub_category = '営業外費用'
  where sub_category is null and name in ('支払利息','雑損失');

update public.accounts set sub_category = '特別利益'
  where sub_category is null and name in ('固定資産売却益');

update public.accounts set sub_category = '特別損失'
  where sub_category is null and name in ('固定資産売却損','固定資産除却損');

-- category が未設定の場合 sub_category から逆引き
update public.accounts set category = 'asset'
  where (category is null or category = '') and sub_category in ('流動資産','固定資産','繰延資産');
update public.accounts set category = 'liability'
  where (category is null or category = '') and sub_category in ('流動負債','固定負債');
update public.accounts set category = 'equity'
  where (category is null or category = '') and sub_category = '純資産';
update public.accounts set category = 'revenue'
  where (category is null or category = '') and sub_category in ('売上高','営業外収益','特別利益');
update public.accounts set category = 'expense'
  where (category is null or category = '') and sub_category in ('売上原価','販管費','営業外費用','特別損失');

-- 3. 会計期間テーブル
create table if not exists public.fiscal_periods (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id uuid references public.clients(id) on delete cascade,
  name text not null,
  start_date date not null,
  end_date date not null,
  created_at timestamptz default now()
);

create index if not exists idx_fiscal_periods_user on public.fiscal_periods(user_id);
create index if not exists idx_fiscal_periods_client on public.fiscal_periods(client_id);

alter table public.fiscal_periods enable row level security;

drop policy if exists "fiscal_periods_owner_all" on public.fiscal_periods;
create policy "fiscal_periods_owner_all"
  on public.fiscal_periods
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
