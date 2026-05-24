-- =============================================================================
-- 2026-05-24: client_id=NULL マスタの廃止（MU🔴4 対応）
--
-- 背景:
--   20260430 で accounts/vendors/account_rules に client_id を追加し、
--   client_id=NULL を「未割当（user の全 client 共有）」として残置していた。
--   しかし「user の複数 client を横断する共有マスタ」は編集が他 client に
--   波及する相互汚染源となるため、client_id を NOT NULL に切替え、
--   既存 NULL は user の保有する全 client へ複製してから削除する。
--
-- 移行内容:
--   1. 既存 NULL レコードを user の所有する各 client にコピー（衝突は skip）
--   2. NULL レコード本体を削除
--   3. client_id を NOT NULL に
--   4. UNIQUE INDEX を (user_id, client_id, ...) に変更（COALESCE 削除）
--   5. ON DELETE SET NULL → CASCADE（client 削除でマスタも消す）
--   6. 新規 client 作成時に他 client からマスタを seed する RPC を追加
-- =============================================================================

-- ── 1. backfill: NULL を user の全 client にコピー ─────────────────────────────
-- accounts
INSERT INTO public.accounts (
  user_id, name, reading, category, sub_category, display_order,
  fixed_asset_type, client_id, auto_registered, confirmed, parent_account_id
)
SELECT
  a.user_id, a.name, a.reading, a.category, a.sub_category, a.display_order,
  a.fixed_asset_type, c.id, a.auto_registered, a.confirmed, NULL
FROM public.accounts a
JOIN public.clients c ON c.user_id = a.user_id
WHERE a.client_id IS NULL
ON CONFLICT (user_id, COALESCE(client_id::text, ''), name) DO NOTHING;

-- vendors
INSERT INTO public.vendors (
  user_id, name, normalized_key, reading, client_id,
  bank_code, branch_code, account_type, account_number, account_name_kana
)
SELECT
  v.user_id, v.name, v.normalized_key, v.reading, c.id,
  v.bank_code, v.branch_code, v.account_type, v.account_number, v.account_name_kana
FROM public.vendors v
JOIN public.clients c ON c.user_id = v.user_id
WHERE v.client_id IS NULL
ON CONFLICT (user_id, COALESCE(client_id::text, ''), normalized_key) DO NOTHING;

-- account_rules
INSERT INTO public.account_rules (
  user_id, pattern_type, pattern, debit_account, client_id
)
SELECT
  r.user_id, r.pattern_type, r.pattern, r.debit_account, c.id
FROM public.account_rules r
JOIN public.clients c ON c.user_id = r.user_id
WHERE r.client_id IS NULL
ON CONFLICT (user_id, COALESCE(client_id::text, ''), pattern_type, pattern) DO NOTHING;

-- ── 2. NULL レコード本体を削除 ─────────────────────────────────────────────────
-- accounts: parent_account_id が NULL レコードを指す可能性は事前確認で 0 件だが
-- 念のため remap せず（FK は ON DELETE SET NULL なので親無し化される）
DELETE FROM public.accounts      WHERE client_id IS NULL;
DELETE FROM public.vendors       WHERE client_id IS NULL;
DELETE FROM public.account_rules WHERE client_id IS NULL;

-- ── 3. NOT NULL 制約 ─────────────────────────────────────────────────────────
ALTER TABLE public.accounts      ALTER COLUMN client_id SET NOT NULL;
ALTER TABLE public.vendors       ALTER COLUMN client_id SET NOT NULL;
ALTER TABLE public.account_rules ALTER COLUMN client_id SET NOT NULL;

-- ── 4. UNIQUE INDEX を再構築（COALESCE を削除） ─────────────────────────────
DROP INDEX IF EXISTS public.accounts_user_client_name_unique;
CREATE UNIQUE INDEX accounts_user_client_name_unique
  ON public.accounts (user_id, client_id, name);

DROP INDEX IF EXISTS public.vendors_user_client_key_unique;
CREATE UNIQUE INDEX vendors_user_client_key_unique
  ON public.vendors (user_id, client_id, normalized_key);

DROP INDEX IF EXISTS public.account_rules_user_client_pattern_uk;
CREATE UNIQUE INDEX account_rules_user_client_pattern_uk
  ON public.account_rules (user_id, client_id, pattern_type, pattern);

-- ── 5. FK 制約を SET NULL → CASCADE に変更 ─────────────────────────────────
-- client_id が NOT NULL になったので SET NULL はそもそも成立不可。
-- client 削除時はマスタも一緒に消える挙動に統一する。
ALTER TABLE public.accounts      DROP CONSTRAINT IF EXISTS accounts_client_id_fkey;
ALTER TABLE public.accounts      ADD CONSTRAINT accounts_client_id_fkey
  FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;

ALTER TABLE public.vendors       DROP CONSTRAINT IF EXISTS vendors_client_id_fkey;
ALTER TABLE public.vendors       ADD CONSTRAINT vendors_client_id_fkey
  FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;

ALTER TABLE public.account_rules DROP CONSTRAINT IF EXISTS account_rules_client_id_fkey;
ALTER TABLE public.account_rules ADD CONSTRAINT account_rules_client_id_fkey
  FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;

COMMENT ON COLUMN public.accounts.client_id      IS '会社ID（必須）';
COMMENT ON COLUMN public.vendors.client_id       IS '会社ID（必須）';
COMMENT ON COLUMN public.account_rules.client_id IS '会社ID（必須）';

-- ── 6. seed_client_masters RPC ─────────────────────────────────────────────
-- 新規 client 作成時に呼び、同一 user の他 client（または指定 source）から
-- accounts / vendors / account_rules を一括 copy する。
-- 一切ソースが無い場合（user 最初の client）は何もしない。
CREATE OR REPLACE FUNCTION public.seed_client_masters(
  p_client_id        uuid,
  p_source_client_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id          uuid;
  v_source_client_id uuid;
  v_acc_count        integer := 0;
  v_ven_count        integer := 0;
  v_rule_count       integer := 0;
BEGIN
  -- target client の所有者
  SELECT user_id INTO v_user_id FROM public.clients WHERE id = p_client_id;
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'client % not found', p_client_id;
  END IF;

  -- 呼び出し元が所有者であることを確認（service_role からも auth.uid()=NULL なので bypass 可）
  IF auth.uid() IS NOT NULL AND v_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'permission denied';
  END IF;

  -- ソース未指定なら、最も accounts 数が多い他 client を自動選択
  IF p_source_client_id IS NULL THEN
    SELECT client_id INTO v_source_client_id
    FROM public.accounts
    WHERE user_id = v_user_id AND client_id <> p_client_id
    GROUP BY client_id
    ORDER BY COUNT(*) DESC
    LIMIT 1;
  ELSE
    PERFORM 1 FROM public.clients WHERE id = p_source_client_id AND user_id = v_user_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'source client % not owned by user', p_source_client_id;
    END IF;
    v_source_client_id := p_source_client_id;
  END IF;

  IF v_source_client_id IS NULL THEN
    -- user 最初の client（コピー元無し）
    RETURN jsonb_build_object('seeded', false, 'reason', 'no_source');
  END IF;

  -- accounts
  WITH inserted AS (
    INSERT INTO public.accounts (
      user_id, name, reading, category, sub_category, display_order,
      fixed_asset_type, client_id, auto_registered, confirmed, parent_account_id
    )
    SELECT
      user_id, name, reading, category, sub_category, display_order,
      fixed_asset_type, p_client_id, auto_registered, confirmed, NULL
    FROM public.accounts
    WHERE client_id = v_source_client_id
    ON CONFLICT (user_id, client_id, name) DO NOTHING
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_acc_count FROM inserted;

  -- vendors
  WITH inserted AS (
    INSERT INTO public.vendors (
      user_id, name, normalized_key, reading, client_id,
      bank_code, branch_code, account_type, account_number, account_name_kana
    )
    SELECT
      user_id, name, normalized_key, reading, p_client_id,
      bank_code, branch_code, account_type, account_number, account_name_kana
    FROM public.vendors
    WHERE client_id = v_source_client_id
    ON CONFLICT (user_id, client_id, normalized_key) DO NOTHING
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_ven_count FROM inserted;

  -- account_rules
  WITH inserted AS (
    INSERT INTO public.account_rules (
      user_id, pattern_type, pattern, debit_account, client_id
    )
    SELECT
      user_id, pattern_type, pattern, debit_account, p_client_id
    FROM public.account_rules
    WHERE client_id = v_source_client_id
    ON CONFLICT (user_id, client_id, pattern_type, pattern) DO NOTHING
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_rule_count FROM inserted;

  RETURN jsonb_build_object(
    'seeded',         true,
    'source_client',  v_source_client_id,
    'accounts',       v_acc_count,
    'vendors',        v_ven_count,
    'account_rules',  v_rule_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.seed_client_masters(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.seed_client_masters(uuid, uuid) TO authenticated, service_role;
