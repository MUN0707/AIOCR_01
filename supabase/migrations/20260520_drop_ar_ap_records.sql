-- ============================================================
-- ar_ap_records / ar_ap_payments テーブルを廃止（段階C）
--
-- 売掛金・買掛金は journal_entries の派生ビューに統一する方針へ。
-- 売掛金 / 未収入金 / 買掛金 / 未払金 / 未払費用 の各科目を
-- vendor 別に集計して残高を算出するため、専用テーブルは不要。
--
-- 廃止前提条件:
--   - ar_ap_records / ar_ap_payments とも 0 件であることを確認済み（2026-05-20）。
--   - 既存 ar_ap_records をユーザーが手入力していた場合は、別途 journal_entries
--     への計上仕訳に置き換える運用に切り替わる。
-- ============================================================

DROP TABLE IF EXISTS public.ar_ap_payments CASCADE;
DROP TABLE IF EXISTS public.ar_ap_records CASCADE;
