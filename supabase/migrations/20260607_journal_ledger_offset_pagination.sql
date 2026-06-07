-- =============================================================================
-- 仕訳日記帳 RPC に offset ベースの真のページングを追加（MU🟡9-followup）
--
-- 背景:
--   旧 fetch_journal_ledger は常に先頭 p_limit 行（+群末尾）しか返せず、
--   API 側の上限 1,000 と相まって「1,000 行を超える日記帳の 1,001 行目以降が
--   一切表示できない」状態だった。p_offset を追加してページ送りを可能にする。
--
-- 群（voucher_group）境界の整合性:
--   多明細仕訳（accrual + payment など）は voucher_group_id でまとまる。さらに
--   計上日と支払日が異なると 1 群が複数の entry_date に跨り、行の並び順
--   (entry_date → group → seq → id) 上で連続しないことがある。
--   そこで「群の先頭行(rn 最小)の位置」でページ帰属を決める:
--     - その群の先頭行 rn が当該ページ窓 [offset+1, offset+limit] に入る群だけを
--       ページに含め、群の全行（窓外の末尾行も）をまとめて返す。
--   これにより群は決して途中で割れず、隣接ページ間で重複もしない
--   （各群の先頭 rn は一意なので、ページ窓の分割は群を漏れ・重複なく分配する）。
--
-- 戻り値に has_more を追加:
--   当該ページより後ろに（先頭行 rn が offset+limit を超える）群が存在するか。
--   フロントの「次へ」ボタン活性判定に使う。filtered_count の行数だけでは
--   末尾の群末尾行が窓外に出るケースで空ページ送りが起きうるため厳密判定する。
-- =============================================================================

DROP FUNCTION IF EXISTS public.fetch_journal_ledger(
  uuid, uuid, text, text, text, text, text, text, text, text, int
);

CREATE OR REPLACE FUNCTION public.fetch_journal_ledger(
  p_user_id uuid,
  p_client_id uuid,
  p_start_date text,            -- 'YYYYMMDD' or ''
  p_end_date text,              -- 'YYYYMMDD' or ''
  p_account_filter text,        -- 借方or貸方の完全一致 or ''
  p_search_debit text,          -- 借方科目の部分一致 or ''
  p_search_credit text,         -- 貸方科目の部分一致 or ''
  p_search_amount text,         -- 金額の部分一致(数字)
  p_search_date text,           -- 日付(YYYYMMDD)の部分一致
  p_search_description text,    -- 摘要の部分一致
  p_limit int,                  -- 1ページの目安件数(群末尾までは超過可)
  p_offset int DEFAULT 0        -- ページ送り開始位置(行 rn ベース)。0 始まり
)
RETURNS TABLE (
  entries jsonb,
  filtered_count bigint,
  total_count bigint,
  closed_until text,
  has_more boolean
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
    NULLIF(p_end_date, '') AS ed,
    NULLIF(p_account_filter, '') AS af,
    NULLIF(p_search_debit, '') AS qd,
    NULLIF(p_search_credit, '') AS qc,
    NULLIF(p_search_amount, '') AS qa,
    NULLIF(p_search_date, '') AS qdate,
    NULLIF(p_search_description, '') AS qdesc,
    GREATEST(p_limit, 1) AS lim,
    GREATEST(COALESCE(p_offset, 0), 0) AS off
),
base AS (
  SELECT je.*
  FROM journal_entries je
  CROSS JOIN params p
  WHERE je.user_id = p.uid
    AND ((p.cid IS NULL AND je.client_id IS NULL) OR je.client_id = p.cid)
),
matched AS (
  SELECT
    b.id,
    b.voucher_group_id,
    b.entry_date,
    b.voucher_seq,
    (
      (p.af IS NULL OR b.debit_account = p.af OR b.credit_account = p.af)
      AND (
        (p.sd IS NULL AND p.ed IS NULL)
        OR (
          b.entry_date <> '不明' AND char_length(b.entry_date) = 8
          AND (p.sd IS NULL OR b.entry_date >= p.sd)
          AND (p.ed IS NULL OR b.entry_date <= p.ed)
        )
      )
      AND (p.qd IS NULL OR b.debit_account ILIKE '%' || p.qd || '%')
      AND (p.qc IS NULL OR b.credit_account ILIKE '%' || p.qc || '%')
      AND (p.qa IS NULL OR
            COALESCE(b.amount::text, '') LIKE '%' || p.qa || '%'
            OR COALESCE(b.debit_amount::text, '') LIKE '%' || p.qa || '%'
            OR COALESCE(b.credit_amount::text, '') LIKE '%' || p.qa || '%'
      )
      AND (p.qdate IS NULL OR b.entry_date LIKE '%' || p.qdate || '%')
      AND (p.qdesc IS NULL OR b.description ILIKE '%' || p.qdesc || '%')
    ) AS is_match
  FROM base b CROSS JOIN params p
),
groups AS (
  SELECT DISTINCT voucher_group_id
  FROM matched
  WHERE is_match AND voucher_group_id IS NOT NULL
),
filtered AS (
  SELECT
    m.id,
    COALESCE(m.voucher_group_id::text, '__single_' || m.id::text) AS gkey,
    ROW_NUMBER() OVER (
      ORDER BY
        m.entry_date NULLS LAST,
        COALESCE(m.voucher_group_id::text, '__single_' || m.id::text),
        m.voucher_seq NULLS FIRST,
        m.id
    ) AS rn
  FROM matched m
  WHERE m.is_match
     OR (m.voucher_group_id IS NOT NULL AND m.voucher_group_id IN (SELECT voucher_group_id FROM groups))
),
grouped AS (
  SELECT
    f.id,
    f.rn,
    MIN(f.rn) OVER (PARTITION BY f.gkey) AS group_first_rn
  FROM filtered f
),
limited AS (
  -- 群の先頭行 rn がページ窓 [off+1, off+lim] に入る群の全行を返す
  SELECT g.id, g.rn
  FROM grouped g, params p
  WHERE g.group_first_rn > p.off
    AND g.group_first_rn <= p.off + p.lim
),
total AS (SELECT COUNT(*) AS n FROM base),
fcount AS (SELECT COUNT(*) AS n FROM filtered),
more AS (
  -- 当該ページより後ろに先頭行を持つ群が存在するか
  SELECT EXISTS (
    SELECT 1 FROM grouped g, params p
    WHERE g.group_first_rn > p.off + p.lim
  ) AS v
),
closing AS (
  SELECT jc.closed_until
  FROM journal_closings jc CROSS JOIN params p
  WHERE jc.user_id = p.uid
    AND ((p.cid IS NULL AND jc.client_id IS NULL) OR jc.client_id = p.cid)
  LIMIT 1
)
SELECT
  COALESCE((
    SELECT jsonb_agg(to_jsonb(je2.*) ORDER BY l.rn)
    FROM limited l
    JOIN journal_entries je2 ON je2.id = l.id
  ), '[]'::jsonb) AS entries,
  (SELECT n FROM fcount)::bigint AS filtered_count,
  (SELECT n FROM total)::bigint AS total_count,
  (SELECT closed_until FROM closing) AS closed_until,
  (SELECT v FROM more) AS has_more;
$$;

COMMENT ON FUNCTION public.fetch_journal_ledger IS
'仕訳日記帳のサーバ側フィルタ + offset ページング。群は先頭行位置でページ帰属を決め、途中分割せず重複もしない。has_more で次ページ有無を返す。';
