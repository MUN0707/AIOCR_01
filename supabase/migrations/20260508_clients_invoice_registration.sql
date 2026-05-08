-- 顧問先に適格請求書発行事業者の登録番号を追加
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS invoice_registration_number text;

COMMENT ON COLUMN public.clients.invoice_registration_number IS
  '適格請求書発行事業者の登録番号（例: T1234567890123）';
