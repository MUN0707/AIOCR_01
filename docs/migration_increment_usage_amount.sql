-- increment_usage を +N 対応に変更
-- 既存の呼び出し（引数2つ）との後方互換性あり（p_amount デフォルト = 1）
--
-- Supabase Dashboard → SQL Editor で実行してください

CREATE OR REPLACE FUNCTION increment_usage(
  p_user_id    UUID,
  p_year_month TEXT,
  p_amount     INT DEFAULT 1
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO usage_logs (user_id, year_month, count, updated_at)
  VALUES (p_user_id, p_year_month, p_amount, now())
  ON CONFLICT (user_id, year_month)
  DO UPDATE SET
    count      = usage_logs.count + p_amount,
    updated_at = now();
END;
$$;

GRANT EXECUTE ON FUNCTION increment_usage(UUID, TEXT, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION increment_usage(UUID, TEXT, INT) TO service_role;
