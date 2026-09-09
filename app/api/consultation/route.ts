import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';

// ビルド時にモジュール評価されてもエラーにならないよう遅延初期化
let _resend: Resend | null = null;
function getResend() {
  if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY);
  return _resend;
}

export const maxDuration = 30;

function clean(v: unknown, max: number): string {
  return String(v ?? '').trim().slice(0, max);
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const name = clean(body.name, 100);
    const office = clean(body.office, 200);
    const email = clean(body.email, 200);
    const preferredTimes = clean(body.preferredTimes, 500);
    const message = clean(body.message, 2000);

    if (!name || !email) {
      return NextResponse.json({ error: 'お名前とメールアドレスは必須です' }, { status: 400 });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: 'メールアドレスの形式が正しくありません' }, { status: 400 });
    }

    const adminEmail = process.env.ADMIN_EMAIL;
    const from = process.env.RESEND_SALES_FROM;
    if (!adminEmail || !from) {
      return NextResponse.json({ error: 'メール送信設定が未構成です' }, { status: 500 });
    }

    const esc = (s: string) =>
      s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    // 1) 管理者（村田尚優）へ予約リクエスト通知
    await getResend().emails.send({
      from,
      to: adminEmail,
      replyTo: email,
      subject: `[無料相談予約] ${office || name} 様`,
      html: `
        <h2>無料オンライン相談の予約リクエスト</h2>
        <p><strong>お名前:</strong> ${esc(name)}</p>
        <p><strong>事務所名:</strong> ${esc(office) || '（未入力）'}</p>
        <p><strong>メール:</strong> ${esc(email)}</p>
        <p><strong>希望日時:</strong><br><pre style="background:#f5f5f5;padding:12px;border-radius:4px;white-space:pre-wrap;">${esc(preferredTimes) || '（未入力）'}</pre></p>
        <p><strong>ご相談内容:</strong><br><pre style="background:#f5f5f5;padding:12px;border-radius:4px;white-space:pre-wrap;">${esc(message) || '（未入力）'}</pre></p>
        <hr>
        <p style="color:#64748b;font-size:13px;">このメールに返信すると相手（${esc(email)}）に直接届きます。Google Meet のURLを添えて日程を確定してください。</p>
      `,
    });

    // 2) 申込者へ自動返信（受付確認）
    await getResend().emails.send({
      from,
      to: email,
      replyTo: adminEmail,
      subject: '【Invoice OCR】無料オンライン相談のお申し込みを受け付けました',
      html: `
        <p>${esc(name)} 様</p>
        <p>この度は Invoice OCR の無料オンライン相談にお申し込みいただき、誠にありがとうございます。</p>
        <p>担当者より、いただいた希望日時をもとに Google Meet のURLと確定日時を追ってご連絡いたします。</p>
        <p style="margin-top:16px;"><strong>ご記入内容</strong><br>
        希望日時: ${esc(preferredTimes) || '（未入力）'}<br>
        ご相談内容: ${esc(message) || '（未入力）'}</p>
        <hr>
        <p style="color:#64748b;font-size:13px;">Invoice OCR / 運営: 村田 尚優<br>本メールに心当たりがない場合は破棄してください。</p>
      `,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('相談予約送信失敗:', error);
    const message = error instanceof Error ? error.message : '送信に失敗しました';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
