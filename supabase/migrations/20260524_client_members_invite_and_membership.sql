-- =============================================================================
-- 2026-05-24: client_members 実権限化（MU🔴2 対応）
--
-- 背景:
--   client_members テーブルは作成済みだが、招待トークン無し・メール送信無し・
--   member 側に auth.users 紐付け無しで「飾り状態」。
--   API は eq('user_id', user.id) でオーナー縛りのため、招待された member は
--   何も見られない。
--
-- 追加カラム:
--   - invite_token        text uniqe  招待 URL に乗せる secret
--   - invite_expires_at   timestamptz 招待の有効期限（7日）
--   - member_user_id      uuid        承諾後に埋まる auth.users.id
--   - accepted_at         timestamptz 承諾日時
--
-- RLS:
--   - 既存 owner ポリシーは維持
--   - member_user_id = auth.uid() でも SELECT 可（自分のメンバーシップ確認用）
-- =============================================================================

ALTER TABLE public.client_members
  ADD COLUMN IF NOT EXISTS invite_token       text,
  ADD COLUMN IF NOT EXISTS invite_expires_at  timestamptz,
  ADD COLUMN IF NOT EXISTS member_user_id     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS accepted_at        timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS client_members_invite_token_uk
  ON public.client_members (invite_token)
  WHERE invite_token IS NOT NULL;

CREATE INDEX IF NOT EXISTS client_members_member_user_idx
  ON public.client_members (member_user_id)
  WHERE member_user_id IS NOT NULL;

COMMENT ON COLUMN public.client_members.invite_token      IS '招待 URL のトークン。承諾後 NULL 化';
COMMENT ON COLUMN public.client_members.invite_expires_at IS '招待の有効期限';
COMMENT ON COLUMN public.client_members.member_user_id    IS '承諾済みメンバーの auth.users.id';
COMMENT ON COLUMN public.client_members.accepted_at       IS '招待承諾日時';

-- ── RLS: member 自身も自分の行を見られるように ────────────────────────────────
DROP POLICY IF EXISTS client_members_member_select ON public.client_members;
CREATE POLICY client_members_member_select ON public.client_members
  FOR SELECT TO authenticated
  USING (member_user_id IS NOT NULL AND auth.uid() = member_user_id);

-- ── 権限チェック helper: user が指定 client にアクセス可能か ─────────────────
-- owner 本人 or accepted_at IS NOT NULL の member であれば true
CREATE OR REPLACE FUNCTION public.user_has_client_access(
  p_user_id   uuid,
  p_client_id uuid
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.clients
    WHERE id = p_client_id AND user_id = p_user_id
  ) OR EXISTS (
    SELECT 1 FROM public.client_members
    WHERE client_id     = p_client_id
      AND member_user_id = p_user_id
      AND accepted_at   IS NOT NULL
  );
$$;

-- role 別チェック (approver / entry / viewer)。owner は常に approver 相当
CREATE OR REPLACE FUNCTION public.user_client_role(
  p_user_id   uuid,
  p_client_id uuid
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  v_is_owner boolean;
  v_role     text;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.clients WHERE id = p_client_id AND user_id = p_user_id
  ) INTO v_is_owner;

  IF v_is_owner THEN
    RETURN 'owner';
  END IF;

  SELECT role INTO v_role
  FROM public.client_members
  WHERE client_id = p_client_id
    AND member_user_id = p_user_id
    AND accepted_at IS NOT NULL
  LIMIT 1;

  RETURN v_role; -- NULL if no access
END;
$$;

REVOKE ALL ON FUNCTION public.user_has_client_access(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.user_client_role(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_has_client_access(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.user_client_role(uuid, uuid) TO authenticated, service_role;
