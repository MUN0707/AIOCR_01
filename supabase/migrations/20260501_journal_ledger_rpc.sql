-- =============================================================================
-- 仕訳日記帳のサーバ側フィルタ + ページング RPC
--
-- 目的:
--   LedgerView は journal_entries を全件(~10000)取得してクライアント側で期間/科目/
--   検索フィルタ + 50 件表示制限をしていた。
--   結果として「50件しか描画しない」のに「fetch は10MB」という非対称な構造で、
--   読み込みスピナーが長く出続けていた。サーバ側で完結させて転送量を最小化する。
--
-- 仕様:
--   - 多明細仕訳の群一致: 検索条件にマッチした行と同じ voucher_group_id を持つ
--     全行も結果に含める（群を途中で切ると意味不明になるため）
--   - LIMIT は行数ベースだが、limit 行目が voucher_group_id を持つ場合は
--     その群の末尾まで含める（クライアント側でやっていたロジックを移植）
--   - ソート順: entry_date → voucher_group_id → voucher_seq → id
-- =============================================================================

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
  p_limit int                   -- 表示件数の目安(群末尾までは超過可)
)
RETURNS TABLE (
  entries jsonb,
  filtered_count bigint,
  total_count bigint,
  closed_until text
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
    GREATEST(p_limit, 1) AS lim
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
    m.voucher_group_id,
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
limited AS (
  SELECT f.id, f.rn
  FROM filtered f, params p
  WHERE f.rn <= p.lim
     OR (
       f.voucher_group_id IS NOT NULL
       AND f.voucher_group_id = (
         SELECT f2.voucher_group_id FROM filtered f2 WHERE f2.rn = p.lim LIMIT 1
       )
     )
),
total AS (SELECT COUNT(*) AS n FROM base),
fcount AS (SELECT COUNT(*) AS n FROM filtered),
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
  (SELECT closed_until FROM closing) AS closed_until;
$$;

COMMENT ON FUNCTION public.fetch_journal_ledger IS
'仕訳日記帳のサーバ側フィルタ + ページング。多明細仕訳の群一致・群末尾保持を含む。';
