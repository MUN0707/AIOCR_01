-- ============================================================
-- 2026-05-14: RLS 一括導入（MU🔴1 対応）
-- ============================================================
-- 背景:
-- - departments / budgets / journal_audit_logs / client_members は RLS 未設定で
--   anon/authenticated キーから直接 SELECT/INSERT/UPDATE/DELETE 可能（重大脆弱性）
-- - journal_entries / accounts / vendors 等は RLS 有効だがポリシー未定義のため
--   service role 経由でしか動かず、API バグや service role 漏洩時に多層防御がない
-- - ocr_uploads / ocr_corrections は qual=true の公開ポリシーが付いており、
--   anon/authenticated でも全件アクセスできてしまう
-- service role は RLS を bypass するため、本 migration による API 影響は無い前提
-- （API ハンドラは createServiceClient 経由でアクセスしている）
-- ============================================================

-- ----- 1. RLS 未設定テーブルを有効化 ----------------------------
ALTER TABLE public.departments         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.budgets             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journal_audit_logs  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_members      ENABLE ROW LEVEL SECURITY;

-- ----- 2. owner_user_id / user_id ベースの ALL ポリシー -----------
-- 既存重複を避けるため DROP IF EXISTS → CREATE
DROP POLICY IF EXISTS departments_owner_all        ON public.departments;
DROP POLICY IF EXISTS budgets_owner_all            ON public.budgets;
DROP POLICY IF EXISTS journal_audit_logs_owner_all ON public.journal_audit_logs;
DROP POLICY IF EXISTS client_members_owner_all     ON public.client_members;

CREATE POLICY departments_owner_all ON public.departments
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY budgets_owner_all ON public.budgets
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY journal_audit_logs_owner_all ON public.journal_audit_logs
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- client_members は member_user_id を持たないので owner ベースのみ（MU🔴2 で拡張予定）
CREATE POLICY client_members_owner_all ON public.client_members
  FOR ALL TO authenticated
  USING (auth.uid() = owner_user_id)
  WITH CHECK (auth.uid() = owner_user_id);

-- ----- 3. RLS 有効だがポリシー欠落だったテーブルの owner ポリシー追加 -----
-- defense in depth: service role 経由が前提だが、漏洩・API バグで anon キーが
-- 直接アクセスしても他人のデータを見られないようにする
DROP POLICY IF EXISTS journal_entries_owner_all   ON public.journal_entries;
DROP POLICY IF EXISTS accounts_owner_all          ON public.accounts;
DROP POLICY IF EXISTS vendors_owner_all           ON public.vendors;
DROP POLICY IF EXISTS ar_ap_records_owner_all     ON public.ar_ap_records;
DROP POLICY IF EXISTS ar_ap_payments_owner_all    ON public.ar_ap_payments;
DROP POLICY IF EXISTS journal_templates_owner_all ON public.journal_templates;
DROP POLICY IF EXISTS company_settings_owner_all  ON public.company_settings;
DROP POLICY IF EXISTS journal_closings_owner_all  ON public.journal_closings;
DROP POLICY IF EXISTS journal_match_logs_owner_all ON public.journal_match_logs;

CREATE POLICY journal_entries_owner_all ON public.journal_entries
  FOR ALL TO authenticated
  USING (user_id IS NOT NULL AND auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY accounts_owner_all ON public.accounts
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY vendors_owner_all ON public.vendors
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY ar_ap_records_owner_all ON public.ar_ap_records
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY ar_ap_payments_owner_all ON public.ar_ap_payments
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY journal_templates_owner_all ON public.journal_templates
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY company_settings_owner_all ON public.company_settings
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY journal_closings_owner_all ON public.journal_closings
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY journal_match_logs_owner_all ON public.journal_match_logs
  FOR ALL TO authenticated
  USING (user_id IS NOT NULL AND auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ----- 4. 危険な qual=true ポリシーを安全なポリシーに置換 ------------
-- ocr_uploads / ocr_corrections は "Service role full access" 名で
-- roles=public, qual=true の公開ポリシーが付いていた（事実上 anon でも全件アクセス可）
DROP POLICY IF EXISTS "Service role full access"               ON public.ocr_uploads;
DROP POLICY IF EXISTS "Service role full access corrections"   ON public.ocr_corrections;
DROP POLICY IF EXISTS ocr_uploads_owner_all                    ON public.ocr_uploads;
DROP POLICY IF EXISTS ocr_corrections_owner_all                ON public.ocr_corrections;

-- ocr_uploads: user_id は nullable（ゲスト分は NULL）。authenticated は自分の分のみ
CREATE POLICY ocr_uploads_owner_all ON public.ocr_uploads
  FOR ALL TO authenticated
  USING (user_id IS NOT NULL AND auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY ocr_corrections_owner_all ON public.ocr_corrections
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
