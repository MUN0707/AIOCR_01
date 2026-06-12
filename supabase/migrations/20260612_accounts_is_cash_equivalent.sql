-- [C1] 勘定科目に「現金及び現金同等物」フラグを追加する。
-- キャッシュフロー計算書の現金同等物抽出や、科目作成時の自動推定の保存先に使う。
ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS is_cash_equivalent boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.accounts.is_cash_equivalent IS
  '現金及び現金同等物（CF計算書対象）か。現金/小口現金/普通預金/当座預金/通知預金などで true。';

-- 既存の標準的な現金預金科目を true に補正する（名称ベース）。
UPDATE public.accounts
SET is_cash_equivalent = true
WHERE is_cash_equivalent = false
  AND (
    name IN ('現金', '小口現金', '普通預金', '当座預金', '通知預金')
    OR name LIKE '%現金'
    OR name LIKE '%普通預金%'
    OR name LIKE '%当座預金%'
    OR name LIKE '%通知預金%'
  );
