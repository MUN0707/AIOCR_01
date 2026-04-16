import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createServiceClient } from '@/utils/supabase/service';

export const maxDuration = 30;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const comment: string = (body.comment ?? '').trim();
    const mode: string | null = body.mode ?? null;
    const context = body.context ?? null;
    const screenshotBase64: string | null = body.screenshot ?? null;
    const siteName: string | null = body.site_name ?? null;

    if (!comment) {
      return NextResponse.json({ error: 'コメントを入力してください' }, { status: 400 });
    }
    if (comment.length > 4000) {
      return NextResponse.json({ error: 'コメントが長すぎます' }, { status: 400 });
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    const service = createServiceClient();

    let screenshotPath: string | null = null;
    if (screenshotBase64) {
      const match = /^data:(image\/(png|jpeg|webp));base64,(.+)$/.exec(screenshotBase64);
      if (!match) {
        return NextResponse.json({ error: 'スクショ形式が不正です' }, { status: 400 });
      }
      const mime = match[1];
      const ext = match[2] === 'jpeg' ? 'jpg' : match[2];
      const buffer = Buffer.from(match[3], 'base64');
      if (buffer.byteLength > 8 * 1024 * 1024) {
        return NextResponse.json({ error: 'スクショは 8MB 以下にしてください' }, { status: 400 });
      }
      const prefix = user?.id ?? 'guest';
      const path = `${prefix}/${Date.now()}-${crypto.randomUUID()}.${ext}`;
      const { error: uploadError } = await service.storage
        .from('error-screenshots')
        .upload(path, buffer, { contentType: mime, upsert: false });
      if (uploadError) {
        return NextResponse.json({ error: `スクショ保存失敗: ${uploadError.message}` }, { status: 500 });
      }
      screenshotPath = path;
    }

    const { error: insertError } = await service.from('error_reports').insert({
      user_id: user?.id ?? null,
      user_email: user?.email ?? null,
      mode,
      comment,
      screenshot_path: screenshotPath,
      context,
      site_name: siteName,
    });

    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('エラー報告失敗:', error);
    const message = error instanceof Error ? error.message : 'エラー報告の送信に失敗しました';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
