-- =============================================================================
-- 仕訳の所属法人(client_id)一括移し替え RPC（C6 / error_report 70cfd088）
--
-- 背景:
--   「間違えた法人を選択して登録してしまった」場合の救済。日記帳で行を選択して
--   別法人へ移す。voucher_group 単位で動かし、紐づく証憑(ocr_uploads)の client_id
--   も連動させる。
--
-- 設計上の注意:
--   - 選択行はその voucher_group 全体に展開して移す（群が分断されないように）。
--   - ocr_uploads は「移動後に source 側（= 移動先 client 以外）から参照され続ける
--     upload は動かさない」。通帳 OCR(bank_ocr_upload_id) は 1 PDF が多数の取引・
--     群から共有されるため、無条件に動かすと無関係な群の証憑所属まで変わってしまう。
--     そのため共有されている upload は据え置き、専有 upload のみ移す。
--   - source / target いずれかの締め日(journal_closings)に掛かる仕訳が含まれる場合は
--     例外 CLOSED_PERIOD を投げて中断（呼び出し側で 403 に変換）。
--   - 権限チェック（from/to 双方への書込権・同一 owner）は API 層で実施し、
--     ここには解決済みの owner user_id を渡す。RPC 内でも user_id でスコープを縛る。
-- =============================================================================

CREATE OR REPLACE FUNCTION public.reassign_voucher_groups(
  p_user_id uuid,
  p_entry_ids uuid[],
  p_from_client uuid,   -- NULL = 個人スコープ
  p_to_client uuid      -- NULL = 個人スコープ（通常は実 client）
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_move_ids uuid[];
  v_upload_ids uuid[];
  v_from_closed text;
  v_to_closed text;
  v_moved_uploads int := 0;
  v_left_uploads int := 0;
  u uuid;
BEGIN
  -- 選択行を同一 voucher_group 全体に展開（from-client スコープ内のみ）
  WITH sel AS (
    SELECT id, voucher_group_id
    FROM journal_entries
    WHERE user_id = p_user_id
      AND id = ANY(p_entry_ids)
      AND client_id IS NOT DISTINCT FROM p_from_client
  ),
  move AS (
    SELECT je.id
    FROM journal_entries je
    WHERE je.user_id = p_user_id
      AND je.client_id IS NOT DISTINCT FROM p_from_client
      AND (
        je.id IN (SELECT id FROM sel)
        OR (je.voucher_group_id IS NOT NULL
            AND je.voucher_group_id IN (SELECT voucher_group_id FROM sel WHERE voucher_group_id IS NOT NULL))
      )
  )
  SELECT array_agg(id) INTO v_move_ids FROM move;

  IF v_move_ids IS NULL OR array_length(v_move_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('moved_entries', 0, 'moved_groups', 0, 'moved_uploads', 0, 'left_uploads', 0);
  END IF;

  -- 締め日ガード（source / target 双方）
  SELECT closed_until INTO v_from_closed
  FROM journal_closings
  WHERE user_id = p_user_id AND client_id IS NOT DISTINCT FROM p_from_client
  LIMIT 1;
  SELECT closed_until INTO v_to_closed
  FROM journal_closings
  WHERE user_id = p_user_id AND client_id IS NOT DISTINCT FROM p_to_client
  LIMIT 1;

  IF EXISTS (
    SELECT 1 FROM journal_entries
    WHERE id = ANY(v_move_ids)
      AND entry_date <> '不明' AND char_length(entry_date) = 8
      AND (
        (v_from_closed IS NOT NULL AND entry_date <= v_from_closed)
        OR (v_to_closed IS NOT NULL AND entry_date <= v_to_closed)
      )
  ) THEN
    RAISE EXCEPTION 'CLOSED_PERIOD';
  END IF;

  -- 参照している証憑 upload を移動前に収集
  SELECT array_agg(DISTINCT uid) INTO v_upload_ids FROM (
    SELECT ocr_upload_id AS uid FROM journal_entries
      WHERE id = ANY(v_move_ids) AND ocr_upload_id IS NOT NULL
    UNION
    SELECT bank_ocr_upload_id FROM journal_entries
      WHERE id = ANY(v_move_ids) AND bank_ocr_upload_id IS NOT NULL
  ) q;

  -- 仕訳の所属を移す
  UPDATE journal_entries SET client_id = p_to_client WHERE id = ANY(v_move_ids);

  -- 専有 upload のみ所属を移す（移動先以外から参照され続けるものは据え置き）
  IF v_upload_ids IS NOT NULL THEN
    FOREACH u IN ARRAY v_upload_ids LOOP
      IF NOT EXISTS (
        SELECT 1 FROM journal_entries
        WHERE (ocr_upload_id = u OR bank_ocr_upload_id = u)
          AND client_id IS DISTINCT FROM p_to_client
      ) THEN
        UPDATE ocr_uploads SET client_id = p_to_client
        WHERE id = u AND (user_id IS NULL OR user_id = p_user_id);
        v_moved_uploads := v_moved_uploads + 1;
      ELSE
        v_left_uploads := v_left_uploads + 1;
      END IF;
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'moved_entries', array_length(v_move_ids, 1),
    'moved_groups', (SELECT COUNT(DISTINCT COALESCE(voucher_group_id::text, '__single_' || id::text))
                     FROM journal_entries WHERE id = ANY(v_move_ids)),
    'moved_uploads', v_moved_uploads,
    'left_uploads', v_left_uploads
  );
END;
$$;

COMMENT ON FUNCTION public.reassign_voucher_groups IS
'仕訳の所属 client を voucher_group 単位で一括移し替え。専有 OCR upload も連動。締め日に掛かる場合は CLOSED_PERIOD 例外。C6/70cfd088。';
