-- =============================================================================
-- マスタの会社別化 + 仕訳の freee 全列対応
--
-- 目的:
--   1. accounts / vendors / account_rules を会社(client_id)単位に分離する
--      （現状は user_id のみで全顧問先共有になっていた）
--   2. journal_entries に税額・税率・複合仕訳・raw_meta などの freee 必須カラムを追加
--
-- 既存データの方針:
--   既存レコードは client_id NULL のまま残置し、UI 側でユーザーが手動で会社割当する。
--   client_id NULL は「会社未割当」を意味する。
-- =============================================================================

-- ── 1. accounts: 勘定科目マスタを会社別に ─────────────────────────────────────
ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL;

ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS auto_registered boolean NOT NULL DEFAULT false;

ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS confirmed boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.accounts.client_id IS '会社ID。NULL は未割当（旧データ）';
COMMENT ON COLUMN public.accounts.auto_registered IS 'インポート時に自動登録された科目か';
COMMENT ON COLUMN public.accounts.confirmed IS 'ユーザーが確認済み(category 等が正しいことを承認)';

DROP INDEX IF EXISTS public.accounts_user_name_unique;
CREATE UNIQUE INDEX IF NOT EXISTS accounts_user_client_name_unique
  ON public.accounts (user_id, COALESCE(client_id::text, ''), name);
CREATE INDEX IF NOT EXISTS accounts_client_idx ON public.accounts (client_id);

-- ── 2. vendors: 取引先マスタを会社別に ───────────────────────────────────────
ALTER TABLE public.vendors
  ADD COLUMN IF NOT EXISTS client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.vendors.client_id IS '会社ID。NULL は未割当（旧データ）';

DROP INDEX IF EXISTS public.vendors_user_key_unique;
CREATE UNIQUE INDEX IF NOT EXISTS vendors_user_client_key_unique
  ON public.vendors (user_id, COALESCE(client_id::text, ''), normalized_key);
CREATE INDEX IF NOT EXISTS vendors_client_idx ON public.vendors (client_id);

-- ── 3. account_rules: 勘定科目自動割当ルールを会社別に ───────────────────────
ALTER TABLE public.account_rules
  ADD COLUMN IF NOT EXISTS client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.account_rules.client_id IS '会社ID。NULL は未割当（旧データ）';

DROP INDEX IF EXISTS public.account_rules_user_pattern_uk;
CREATE UNIQUE INDEX IF NOT EXISTS account_rules_user_client_pattern_uk
  ON public.account_rules (user_id, COALESCE(client_id::text, ''), pattern_type, pattern);
CREATE INDEX IF NOT EXISTS account_rules_client_idx ON public.account_rules (client_id);

-- ── 4. journal_entries: freee 全列対応のための拡張カラム ─────────────────────
-- 複合仕訳で1行に借方/貸方両方の金額が立つケースに対応するため、
-- amount 単一カラムを残しつつ、debit_amount / credit_amount を独立で持つ。
ALTER TABLE public.journal_entries
  ADD COLUMN IF NOT EXISTS debit_amount  numeric,
  ADD COLUMN IF NOT EXISTS credit_amount numeric,
  ADD COLUMN IF NOT EXISTS tax_amount    numeric,
  ADD COLUMN IF NOT EXISTS tax_rate      text,
  ADD COLUMN IF NOT EXISTS is_internal_tax boolean,
  ADD COLUMN IF NOT EXISTS voucher_seq   integer,
  ADD COLUMN IF NOT EXISTS voucher_total_lines integer,
  ADD COLUMN IF NOT EXISTS meta          jsonb;

COMMENT ON COLUMN public.journal_entries.debit_amount IS '借方金額（freee の借方金額列）';
COMMENT ON COLUMN public.journal_entries.credit_amount IS '貸方金額（freee の貸方金額列）';
COMMENT ON COLUMN public.journal_entries.tax_amount IS '税額（借方税金額または貸方税金額のうち非ゼロ側）';
COMMENT ON COLUMN public.journal_entries.tax_rate IS '税率 ("10","8" など)';
COMMENT ON COLUMN public.journal_entries.is_internal_tax IS '内税(true) / 外税(false)';
COMMENT ON COLUMN public.journal_entries.voucher_seq IS '同一仕訳内の行番号 (1始まり)';
COMMENT ON COLUMN public.journal_entries.voucher_total_lines IS '同一仕訳の総行数';
COMMENT ON COLUMN public.journal_entries.meta IS 'freee CSV の raw 行データ等、追加情報を JSONB で保持';

CREATE INDEX IF NOT EXISTS journal_entries_voucher_group_idx
  ON public.journal_entries (voucher_group_id) WHERE voucher_group_id IS NOT NULL;

-- ── 5. 既存データの amount を debit_amount / credit_amount に複写（単純仕訳前提）
UPDATE public.journal_entries
   SET debit_amount = amount,
       credit_amount = amount
 WHERE debit_amount IS NULL
   AND credit_amount IS NULL
   AND amount IS NOT NULL;
