-- =============================================================================
-- 残高画面のサーバ集計RPC
--
-- 目的:
--   残高(BalanceView)はクライアントで journal_entries を全件取得して集計していたため、
--   1万件規模で読み込みが遅くなっていた。SQL の GROUP BY でサーバ側集計に切替える。
--
-- 戻り値:
--   side: 'debit' | 'credit'
--   account, vendor 単位での金額・件数
--   両 side を JS 側でマージして {accountBalances, vendorBreakdownByAccount} を構築する
-- =============================================================================

CREATE OR REPLACE FUNCTION public.compute_journal_balance(
  p_user_id uuid,
  p_client_id uuid,
  p_start_date text,    -- 'YYYYMMDD' or '' (= 全期間)
  p_end_date text       -- 'YYYYMMDD' or '' (= 全期間)
)
RETURNS TABLE (
  side text,
  account text,
  vendor text,
  amount numeric,
  entry_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH params AS (
    SELECT
      p_user_id AS uid,
      p_client_id AS cid,
      NULLIF(p_start_date, '') AS sd,
      NULLIF(p_end_date, '') AS ed
  ),
  base AS (
    SELECT
      je.debit_account,
      je.credit_account,
      COALESCE(je.debit_amount, je.amount, 0)  AS d_amt,
      COALESCE(je.credit_amount, je.amount, 0) AS c_amt,
      COALESCE(NULLIF(TRIM(je.vendor_name), ''), '(取引先未登録)') AS vendor,
      je.entry_date
    FROM journal_entries je, params
    WHERE je.user_id = params.uid
      AND ((params.cid IS NULL AND je.client_id IS NULL) OR je.client_id = params.cid)
      AND (
        -- 期間フィルタ未指定なら entry_date 不明を含めて全件
        (params.sd IS NULL AND params.ed IS NULL)
        OR (
          je.entry_date <> '不明'
          AND char_length(je.entry_date) = 8
          AND (params.sd IS NULL OR je.entry_date >= params.sd)
          AND (params.ed IS NULL OR je.entry_date <= params.ed)
        )
      )
  )
  SELECT
    'debit'::text  AS side,
    debit_account  AS account,
    vendor,
    SUM(d_amt)     AS amount,
    COUNT(*)       AS entry_count
  FROM base
  WHERE debit_account IS NOT NULL
    AND debit_account NOT IN ('不明', '(不明)')
  GROUP BY debit_account, vendor

  UNION ALL

  SELECT
    'credit'::text AS side,
    credit_account AS account,
    vendor,
    SUM(c_amt)     AS amount,
    COUNT(*)       AS entry_count
  FROM base
  WHERE credit_account IS NOT NULL
    AND credit_account NOT IN ('不明', '(不明)')
  GROUP BY credit_account, vendor;
$$;

COMMENT ON FUNCTION public.compute_journal_balance IS
'残高画面用の科目×取引先 集計。BalanceView がクライアント集計していたものをサーバ側に移管。';

-- 件数取得用（対象仕訳 X / Y 件 表示）
CREATE OR REPLACE FUNCTION public.compute_journal_counts(
  p_user_id uuid,
  p_client_id uuid,
  p_start_date text,
  p_end_date text
)
RETURNS TABLE (
  total_count bigint,
  filtered_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH params AS (
    SELECT
      p_user_id AS uid,
      p_client_id AS cid,
      NULLIF(p_start_date, '') AS sd,
      NULLIF(p_end_date, '') AS ed
  ),
  scoped AS (
    SELECT je.entry_date
    FROM journal_entries je, params
    WHERE je.user_id = params.uid
      AND ((params.cid IS NULL AND je.client_id IS NULL) OR je.client_id = params.cid)
  )
  SELECT
    (SELECT COUNT(*) FROM scoped)::bigint AS total_count,
    (SELECT COUNT(*) FROM scoped, params
       WHERE (params.sd IS NULL AND params.ed IS NULL)
          OR (
            scoped.entry_date <> '不明'
            AND char_length(scoped.entry_date) = 8
            AND (params.sd IS NULL OR scoped.entry_date >= params.sd)
            AND (params.ed IS NULL OR scoped.entry_date <= params.ed)
          )
    )::bigint AS filtered_count;
$$;

COMMENT ON FUNCTION public.compute_journal_counts IS
'残高画面の「対象仕訳 X / Y 件」表示用カウント。';
