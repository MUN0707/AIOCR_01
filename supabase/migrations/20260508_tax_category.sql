-- 消費税区分カラム追加
ALTER TABLE public.journal_entries
  ADD COLUMN IF NOT EXISTS tax_category text
  CHECK (tax_category IN ('taxable_sales', 'tax_exempt_sales', 'taxable_purchase', 'non_taxable'));

COMMENT ON COLUMN public.journal_entries.tax_category IS
  '消費税区分: taxable_sales(課税売上) / tax_exempt_sales(非課税売上) / taxable_purchase(課税仕入) / non_taxable(免税・不課税)';

CREATE INDEX IF NOT EXISTS journal_entries_tax_category_idx
  ON public.journal_entries (user_id, client_id, tax_category)
  WHERE tax_category IS NOT NULL;
