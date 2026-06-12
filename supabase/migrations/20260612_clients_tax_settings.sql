-- [C5] クライアントに消費税の課税事業者設定を追加する。
-- is_taxable    : 課税事業者かどうか（false=免税事業者 → 消費税集計をスキップ）
-- tax_method    : 課税方式 'honsoku'(本則課税) / 'kani'(簡易課税)
-- simplified_rate: 簡易課税のみなし仕入率（0〜1、tax_method='kani' のとき使用）
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS is_taxable boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS tax_method text NOT NULL DEFAULT 'honsoku',
  ADD COLUMN IF NOT EXISTS simplified_rate numeric(3,2);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'clients_tax_method_check'
  ) THEN
    ALTER TABLE public.clients
      ADD CONSTRAINT clients_tax_method_check CHECK (tax_method IN ('honsoku', 'kani'));
  END IF;
END $$;

COMMENT ON COLUMN public.clients.is_taxable IS '課税事業者か。false=免税事業者(消費税集計をスキップ)';
COMMENT ON COLUMN public.clients.tax_method IS '課税方式 honsoku=本則課税 / kani=簡易課税';
COMMENT ON COLUMN public.clients.simplified_rate IS '簡易課税のみなし仕入率(0〜1)。tax_method=kani のとき使用';
