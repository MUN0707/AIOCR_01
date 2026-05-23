-- プラン上限を DB ドリブン化
-- 旧: app/api/process-pdf/route.ts などに PLAN_LIMITS 定数が散在しプラン変更時にコード+デプロイが必要
-- 新: plans テーブルから動的取得し、運用画面 or SQL で書き換えるだけで反映
CREATE TABLE IF NOT EXISTS public.plans (
  plan_key text PRIMARY KEY,
  monthly_limit integer NOT NULL,
  display_name text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.plans (plan_key, monthly_limit, display_name) VALUES
  ('lite', 30, 'Lite'),
  ('standard', 100, 'Standard'),
  ('pro', 300, 'Pro'),
  ('enterprise', 1000, 'Enterprise'),
  ('trial', 10, 'Trial')
ON CONFLICT (plan_key) DO UPDATE SET
  monthly_limit = EXCLUDED.monthly_limit,
  display_name  = EXCLUDED.display_name,
  updated_at    = now();

-- プラン上限は機密情報ではないので anon にも SELECT 許可
GRANT SELECT ON public.plans TO anon, authenticated, service_role;
