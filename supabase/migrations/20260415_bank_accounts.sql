-- 口座マスタ: 通帳PDFの (銀行名, 口座番号) を預金科目に紐付ける
CREATE TABLE IF NOT EXISTS public.bank_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  bank_name text NOT NULL,
  account_number text NOT NULL,
  account_label text,
  deposit_account text NOT NULL DEFAULT '普通預金',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS bank_accounts_unique
  ON public.bank_accounts (user_id, COALESCE(client_id::text, ''), bank_name, account_number);

ALTER TABLE public.bank_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own_bank_accounts" ON public.bank_accounts;
CREATE POLICY "own_bank_accounts" ON public.bank_accounts
  FOR ALL USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

COMMENT ON TABLE public.bank_accounts IS '口座マスタ。通帳PDFの(銀行名,口座番号)を預金科目に紐付ける';
