-- accounts 科目名変更時の N+1 解消
-- 旧: 借方/貸方 journal_entries を別 UPDATE = フルスキャン2回
-- 新: CASE WHEN で 1 UPDATE に集約 (フィルタも OR で 1パス)
CREATE OR REPLACE FUNCTION public.rename_account_in_journal_entries(
  p_user_id uuid,
  p_previous_name text,
  p_new_name text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  UPDATE public.journal_entries
  SET
    debit_account  = CASE WHEN debit_account  = p_previous_name THEN p_new_name ELSE debit_account  END,
    credit_account = CASE WHEN credit_account = p_previous_name THEN p_new_name ELSE credit_account END
  WHERE user_id = p_user_id
    AND (debit_account = p_previous_name OR credit_account = p_previous_name);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rename_account_in_journal_entries(uuid, text, text) TO authenticated, service_role;
