-- AIOCR 専用の管理者テーブル
-- ADMIN_EMAIL 環境変数によるハードコード認可を廃止し、複数管理者と将来の権限細分化に対応
CREATE TABLE IF NOT EXISTS public.aiocr_admins (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.aiocr_admins ENABLE ROW LEVEL SECURITY;

-- 認証ユーザー自身は自分の admin 行が見える（クライアント側で isAdmin 判定するため）
DROP POLICY IF EXISTS aiocr_admins_self_select ON public.aiocr_admins;
CREATE POLICY aiocr_admins_self_select ON public.aiocr_admins
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- 初期データ: 既存 ADMIN_EMAIL のユーザーを登録
INSERT INTO public.aiocr_admins (user_id, email, note)
SELECT id, email, 'initial admin (migrated from ADMIN_EMAIL env)'
FROM auth.users
WHERE email = 'negitoro0707@gmail.com'
ON CONFLICT (user_id) DO NOTHING;
