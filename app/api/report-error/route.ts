import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { Resend } from 'resend';

// ビルド時にモジュール評価されてもエラーにならないよう遅延初期化
let _resend: Resend | null = null;
function getResend() {
  if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY);
  return _resend;
}

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
      const { error: uploadError } = await supabase.storage
        .from('error-screenshots')
        .upload(path, buffer, { contentType: mime, upsert: false });
      if (uploadError) {
        return NextResponse.json({ error: `スクショ保存失敗: ${uploadError.message}` }, { status: 500 });
      }
      screenshotPath = path;
    }

    const { error: insertError } = await supabase.from('error_reports').insert({
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

    // 自分以外のユーザーからの報告時のみ管理者にメール通知
    const reporterEmail = user?.email ?? '未ログイン';
    const adminEmail = process.env.ADMIN_EMAIL;
    if (adminEmail && reporterEmail !== adminEmail) {
      try {
        await getResend().emails.send({
          from: process.env.RESEND_SALES_FROM!,
          to: adminEmail,
          subject: `[エラー報告] ${siteName ?? 'unknown'} - ${reporterEmail}`,
          html: `
            <h2>新しいエラー報告</h2>
            <p><strong>報告者:</strong> ${reporterEmail}</p>
            <p><strong>サイト:</strong> ${siteName ?? '不明'}</p>
            <p><strong>ページ:</strong> ${context?.page ?? '不明'}</p>
            <p><strong>コメント:</strong></p>
            <pre style="background:#f5f5f5;padding:12px;border-radius:4px;white-space:pre-wrap;">${comment}</pre>
            ${screenshotPath ? '<p><em>スクリーンショット添付あり（管理画面で確認）</em></p>' : ''}
          `,
        });
      } catch (emailError) {
        console.error('通知メール送信失敗:', emailError);
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('エラー報告失敗:', error);
    const message = error instanceof Error ? error.message : 'エラー報告の送信に失敗しました';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
