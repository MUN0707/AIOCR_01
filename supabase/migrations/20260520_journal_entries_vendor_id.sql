-- ============================================================
-- journal_entries.vendor_id を追加（取引先正規化・段階B）
--
-- 目的:
--   vendor_name は OCR が拾った文字列を保存しており表記揺れが残る
--   （「株式会社○○商事」「○○商事(株)」「ﾌﾘｺﾐ ○○ｼｮｳｼﾞ」等）。
--   集計時に同一取引先が複数行に割れて「取引先別残高」が破綻するため、
--   vendors テーブルへの FK 参照 vendor_id を追加する。
--
-- 方針:
--   - vendor_id は nullable。既存データは NULL のまま。
--   - 新規 OCR/手動仕訳/インポート時に vendor を解決して埋める。
--   - 既存データの表記揺れは「vendor 統合画面」で手動でマージする。
--   - 集計クエリは vendor_id を優先、無ければ vendor_name fallback。
-- ============================================================

ALTER TABLE public.journal_entries
  ADD COLUMN IF NOT EXISTS vendor_id uuid REFERENCES public.vendors(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.journal_entries.vendor_id IS
  '取引先マスタへの参照。新規仕訳から自動設定。NULL は未解決（旧データまたは vendor_name 空）';

CREATE INDEX IF NOT EXISTS journal_entries_vendor_idx
  ON public.journal_entries (user_id, vendor_id, entry_date);
