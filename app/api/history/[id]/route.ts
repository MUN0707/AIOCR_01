import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createServiceClient } from '@/utils/supabase/service';

export const maxDuration = 15;

/**
 * DELETE /api/history/[id]?target=journal_entries
 *   - 指定した OCR アップロード (ocr_uploads.id) から生成された仕訳を一括削除する。
 *     ocr_upload_id / bank_ocr_upload_id のどちらに紐付いているものも対象。
 *     締め済みの行はスキップ（既存 bulk-delete と同じロジック）。
 *     アップロード本体（ocr_uploads）は削除しない — 履歴自体は残す方針。
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

  // アップロードの所有権確認
  const { data: upload } = await service
    .from('ocr_uploads')
    .select('id, user_id')
    .eq('id', uploadId)
    .single();
  if (!upload || upload.user_id !== user.id) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  if (target !== 'journal_entries') {
    return NextResponse.json({ error: 'unsupported target' }, { status: 400 });
  }

  // このアップロードに紐付く仕訳を全取得
  const { data: entries } = await service
    .from('journal_entries')
    .select('id, client_id, entry_date')
    .eq('user_id', user.id)
    .or(`ocr_upload_id.eq.${uploadId},bank_ocr_upload_id.eq.${uploadId}`);

  if (!entries || entries.length === 0) {
    return NextResponse.json({ success: true, deleted: 0, skipped: 0 });
  }

  // 締めロック確認
  const { data: closings } = await service
    .from('journal_closings')
    .select('client_id, closed_until')
    .eq('user_id', user.id);

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
    .eq('user_id', user.id);

  if (delError) return NextResponse.json({ error: delError.message }, { status: 500 });

  return NextResponse.json({ success: true, deleted: allowed.length, skipped: blocked.length });
}

/**
 * PATCH /api/history/[id]
 *   body: { clientId: string | null }
 *   OCRアップロードを別法人（client）に紐付け直す。
 *   併せて、このアップロードから生成された journal_entries の client_id も一括更新する。
 *   締め済みの行は client_id を変更しない（スキップ件数を返す）。
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
  if (!upload || upload.user_id !== user.id) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  // 新しい client_id が指定された場合、所有権を検証
  if (newClientId) {
    const { data: client } = await service
      .from('clients')
      .select('id, user_id')
      .eq('id', newClientId)
      .single();
    if (!client || client.user_id !== user.id) {
      return NextResponse.json({ error: '無効なクライアントID' }, { status: 400 });
    }
  }

  // アップロード本体を更新
  const { error: upErr } = await service
    .from('ocr_uploads')
    .update({ client_id: newClientId })
    .eq('id', uploadId)
    .eq('user_id', user.id);
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  // このアップロードに紐付く仕訳を取得
  const { data: entries } = await service
    .from('journal_entries')
    .select('id, client_id, entry_date')
    .eq('user_id', user.id)
    .or(`ocr_upload_id.eq.${uploadId},bank_ocr_upload_id.eq.${uploadId}`);

  if (!entries || entries.length === 0) {
    return NextResponse.json({ success: true, updated: 0, skipped: 0 });
  }

  // 締め済みはスキップ（変更元/先どちらの締めにも該当する行は触らない）
  const { data: closings } = await service
    .from('journal_closings')
    .select('client_id, closed_until')
    .eq('user_id', user.id);
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
      // 仕訳を移動せず削除する
      const { error: delErr } = await service
        .from('journal_entries')
        .delete()
        .in('id', allowed)
        .eq('user_id', user.id);
      if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });
    } else {
      // 仕訳を新法人に移動する
      const { error: updErr } = await service
        .from('journal_entries')
        .update({ client_id: newClientId })
        .in('id', allowed)
        .eq('user_id', user.id);
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
