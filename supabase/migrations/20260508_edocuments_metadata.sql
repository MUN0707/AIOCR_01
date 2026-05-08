-- 電子帳簿保存法対応: ocr_uploads に必須メタデータカラムを追加
ALTER TABLE public.ocr_uploads
  ADD COLUMN IF NOT EXISTS doc_category     text,   -- 書類区分: invoice/receipt/contract/other
  ADD COLUMN IF NOT EXISTS receipt_date     date,   -- 取引年月日（検索要件①）
  ADD COLUMN IF NOT EXISTS transaction_amount numeric, -- 取引金額（検索要件②）
  ADD COLUMN IF NOT EXISTS counterparty     text,   -- 取引先名（検索要件③）
  ADD COLUMN IF NOT EXISTS edoc_notes       text;   -- 備考（補足情報）

COMMENT ON COLUMN public.ocr_uploads.doc_category IS '書類区分: invoice(請求書) / receipt(領収書) / contract(契約書) / other(その他)';
COMMENT ON COLUMN public.ocr_uploads.receipt_date IS '取引年月日（電帳法 検索要件①）';
COMMENT ON COLUMN public.ocr_uploads.transaction_amount IS '取引金額（電帳法 検索要件②）';
COMMENT ON COLUMN public.ocr_uploads.counterparty IS '取引先名（電帳法 検索要件③）';

-- 検索用インデックス（日付・金額範囲・取引先部分一致）
CREATE INDEX IF NOT EXISTS ocr_uploads_receipt_date_idx
  ON public.ocr_uploads (user_id, client_id, receipt_date)
  WHERE receipt_date IS NOT NULL;

CREATE INDEX IF NOT EXISTS ocr_uploads_counterparty_idx
  ON public.ocr_uploads USING gin(to_tsvector('simple', coalesce(counterparty, '')));
