import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createServiceClient } from '@/utils/supabase/service';
import { canWrite, resolveClientScope } from '@/lib/client-access';

export const maxDuration = 15;

/**
 * DELETE /api/history/[id]?target=journal_entries
 *   - 指定した OCR アップロード (ocr_uploads.id) から生成された仕訳を一括削除する。
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: uploadId } = await params;
  const url = new URL(request.url);
  const target = url.searchParams.get('target') ?? 'journal_entries';

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const service = createServiceClient();

  // アップロードの所有権確認（owner or client write 権限）
  const { data: upload } = await service
    .from('ocr_uploads')
    .select('id, user_id, client_id')
    .eq('id', uploadId)
    .single();
  if (!upload) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  let ownerUserId = user.id;
  if (upload.client_id) {
    const scope = await resolveClientScope(service, user.id, upload.client_id);
    if (!scope || !canWrite(scope.role)) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }
    ownerUserId = scope.ownerUserId;
  } else {
    if (upload.user_id !== user.id) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }
  }

  if (target !== 'journal_entries') {
    return NextResponse.json({ error: 'unsupported target' }, { status: 400 });
  }

  // このアップロードに紐付く仕訳を全取得
  const { data: entries } = await service
    .from('journal_entries')
    .select('id, client_id, entry_date')
    .eq('user_id', ownerUserId)
    .or(`ocr_upload_id.eq.${uploadId},bank_ocr_upload_id.eq.${uploadId}`);

  if (!entries || entries.length === 0) {
    return NextResponse.json({ success: true, deleted: 0, skipped: 0 });
  }

  // 締めロック確認
  const { data: closings } = await service
    .from('journal_closings')
    .select('client_id, closed_until')
    .eq('user_id', ownerUserId);

  const closedMap = new Map<string | null, string>();
  for (const c of closings ?? []) closedMap.set(c.client_id ?? null, c.closed_until);

  const allowed: string[] = [];
  const blocked: string[] = [];
  for (const e of entries) {
    const key: string | null = e.client_id ?? null;
    const closedUntil = closedMap.get(key);
    if (closedUntil && e.entry_date !== '不明' && e.entry_date <= closedUntil) {
      blocked.push(e.id);
    } else {
      allowed.push(e.id);
    }
  }

  if (allowed.length === 0) {
    return NextResponse.json({ error: 'すべて締め済みのため削除できません', skipped: blocked.length }, { status: 403 });
  }

  const { error: delError } = await service
    .from('journal_entries')
    .delete()
    .in('id', allowed)
    .eq('user_id', ownerUserId);

  if (delError) return NextResponse.json({ error: delError.message }, { status: 500 });

  return NextResponse.json({ success: true, deleted: allowed.length, skipped: blocked.length });
}

/**
 * PATCH /api/history/[id]
 *   body: { clientId: string | null }
 *   OCRアップロードを別法人（client）に紐付け直す。
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: uploadId } = await params;
  const body = await request.json();
  const newClientId: string | null = body.clientId ?? null;
  const deleteEntries: boolean = body.deleteEntries === true;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const service = createServiceClient();

  // アップロード所有権確認
  const { data: upload } = await service
    .from('ocr_uploads')
    .select('id, user_id, client_id')
    .eq('id', uploadId)
    .single();
  if (!upload) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  let ownerUserId = user.id;
  if (upload.client_id) {
    const scope = await resolveClientScope(service, user.id, upload.client_id);
    if (!scope || !canWrite(scope.role)) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }
    ownerUserId = scope.ownerUserId;
  } else {
    if (upload.user_id !== user.id) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }
  }

  // 新しい client_id が指定された場合、移動先の書き込み権限を検証
  if (newClientId) {
    const dstScope = await resolveClientScope(service, user.id, newClientId);
    if (!dstScope || !canWrite(dstScope.role)) {
      return NextResponse.json({ error: '移動先会社の書き込み権限がありません' }, { status: 403 });
    }
    // owner が異なる client への移動は許可しない（owner 跨ぎは想定外）
    if (dstScope.ownerUserId !== ownerUserId) {
      return NextResponse.json({ error: '別 owner の会社への移動はできません' }, { status: 400 });
    }
  }

  // アップロード本体を更新
  const { error: upErr } = await service
    .from('ocr_uploads')
    .update({ client_id: newClientId })
    .eq('id', uploadId)
    .eq('user_id', ownerUserId);
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  // このアップロードに紐付く仕訳を取得
  const { data: entries } = await service
    .from('journal_entries')
    .select('id, client_id, entry_date')
    .eq('user_id', ownerUserId)
    .or(`ocr_upload_id.eq.${uploadId},bank_ocr_upload_id.eq.${uploadId}`);

  if (!entries || entries.length === 0) {
    return NextResponse.json({ success: true, updated: 0, skipped: 0 });
  }

  // 締め済みはスキップ
  const { data: closings } = await service
    .from('journal_closings')
    .select('client_id, closed_until')
    .eq('user_id', ownerUserId);
  const closedMap = new Map<string | null, string>();
  for (const c of closings ?? []) closedMap.set(c.client_id ?? null, c.closed_until);

  const allowed: string[] = [];
  const skipped: string[] = [];
  for (const e of entries) {
    const curKey: string | null = e.client_id ?? null;
    const curClosed = closedMap.get(curKey);
    const newClosed = closedMap.get(newClientId);
    const locked =
      (curClosed && e.entry_date !== '不明' && e.entry_date <= curClosed) ||
      (newClosed && e.entry_date !== '不明' && e.entry_date <= newClosed);
    if (locked) skipped.push(e.id);
    else allowed.push(e.id);
  }

  if (allowed.length > 0) {
    if (deleteEntries) {
      const { error: delErr } = await service
        .from('journal_entries')
        .delete()
        .in('id', allowed)
        .eq('user_id', ownerUserId);
      if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });
    } else {
      const { error: updErr } = await service
        .from('journal_entries')
        .update({ client_id: newClientId })
        .in('id', allowed)
        .eq('user_id', ownerUserId);
      if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });
    }
  }

  return NextResponse.json({
    success: true,
    updated: deleteEntries ? 0 : allowed.length,
    deleted: deleteEntries ? allowed.length : 0,
    skipped: skipped.length,
  });
}
