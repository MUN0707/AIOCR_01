import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { createServiceClient } from '@/utils/supabase/service';
import { AUTH_COOKIE_OPTIONS } from '@/utils/supabase/cookie-options';
import { AIOCR_PLANS, MERUMAGA_PLANS, type AiocrPlanId } from '@/lib/services';
import { generateInvoicePdf, nextInvoiceNo } from '@/lib/invoice-pdf';
import { resendCall, resendSendEmail } from '@/lib/resend-helper';

export const runtime = 'nodejs'; // pdfkit が node:fs を使うため Edge ではなく Node ランタイム必須

type Payload = {
  // 認証（未ログイン時のみ）
  email?: string;
  password?: string;
  // 共通
  companyName: string;
  contactName: string;
  phone?: string;
  // サービス選択
  withAiocr: boolean;
  aiocrPlan?: AiocrPlanId;
  withMerumaga: boolean;
};

// 申込確定時に「初月分の請求書」を1件発行する。
// PDF を Storage に保存し、invoices 行を作り、Resend で添付メール送信。
// price は税込価格（LP/特商法表記が税込のため）。1.1 で割って税抜に逆算。
async function issueAndSendInvoice(params: {
  userId: string;
  userEmail: string;
  service: 'aiocr' | 'merumaga';
  itemName: string;
  priceInclTax: number;
  issuedToName: string;
  issuedToContact: string;
}): Promise<void> {
  const TAX_RATE = 0.10;
  const subtotal = Math.floor(params.priceInclTax / (1 + TAX_RATE));
  const tax = params.priceInclTax - subtotal;
  const issuedAt = new Date();
  const dueAt = new Date(issuedAt.getTime() + 30 * 24 * 60 * 60 * 1000);

  const invoiceNo = await nextInvoiceNo();
  const invoiceId = randomUUID();
  const pdfPath = `${params.userId}/${invoiceId}.pdf`;

  const pdfBuffer = await generateInvoicePdf({
    invoiceNo,
    issuedAt,
    dueAt,
    issuedToName: params.issuedToName,
    issuedToContact: params.issuedToContact,
    items: [{ name: params.itemName, quantity: 1, unitPrice: subtotal }],
    taxRate: TAX_RATE,
    notes: 'ご入金前から各サービスはすぐにご利用いただけます。配信用メーリスへのメンバー登録は本日から可能です。',
  });

  const service = createServiceClient();
  await service.storage.from('invoices').upload(pdfPath, pdfBuffer, {
    contentType: 'application/pdf',
    upsert: true,
  });
  await service.from('invoices').insert({
    id: invoiceId,
    user_id: params.userId,
    service: params.service,
    invoice_no: invoiceNo,
    issued_to_name: params.issuedToName,
    issued_to_contact: params.issuedToContact,
    amount_excl_tax: subtotal,
    tax_rate: TAX_RATE,
    tax_amount: tax,
    amount_incl_tax: params.priceInclTax,
    status: 'issued',
    pdf_path: pdfPath,
    issued_at: issuedAt.toISOString(),
    due_at: dueAt.toISOString(),
  });

  const dueStr = dueAt.toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' });
  const sendResult = await resendSendEmail({
    from: '請求書 <info@taxbestsearch.com>',
    to: params.userEmail,
    subject: `【請求書】${params.itemName}（${invoiceNo}）`,
    html: `<p>${params.issuedToName} 様</p>
<p>このたびは「${params.itemName}」をお申込みいただきありがとうございます。</p>
<p>初月分の請求書（<strong>${invoiceNo}</strong>）を本メールに添付しております。<br>
お支払期日：<strong>${dueStr}</strong></p>
<p><strong>ご入金前から各サービスはすぐにご利用いただけます。</strong>マイページからメーリスのメンバー登録を進めてください。</p>
<p>ご不明点は本メールへの返信、もしくは info@taxbestsearch.com までお願いいたします。</p>`,
    attachments: [
      { filename: `${invoiceNo}.pdf`, content: pdfBuffer.toString('base64') },
    ],
  });
  if (!sendResult.ok) {
    throw new Error(`Resend invoice email failed: ${sendResult.error}`);
  }
  if (sendResult.usedBackup) {
    console.warn('[resend] invoice email sent via BACKUP key');
  }
}

// Resend Audience を自動作成（メルマガ申込時に1事務所＝1メーリス）。
// primary キー失敗時は backup キーへ自動フェイルオーバー。
async function createMerumagaAudience(firmName: string): Promise<string | null> {
  try {
    const r = await resendCall('/audiences', {
      method: 'POST',
      body: { name: `merumaga / ${firmName}` },
    });
    if (!r.ok) {
      console.error('Resend audience create failed:', r.status, JSON.stringify(r.data));
      return null;
    }
    return (r.data as { id?: string } | null)?.id ?? null;
  } catch (e) {
    console.error('Resend audience create error:', e);
    return null;
  }
}

export async function POST(request: NextRequest) {
  let payload: Payload;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: '不正なリクエスト' }, { status: 400 });
  }

  const { companyName, contactName, phone, withAiocr, withMerumaga } = payload;

  if (!withAiocr && !withMerumaga) {
    return NextResponse.json({ error: 'いずれか1つ以上のサービスを選択してください' }, { status: 400 });
  }
  if (!companyName?.trim() || !contactName?.trim()) {
    return NextResponse.json({ error: '会社名・担当者名は必須です' }, { status: 400 });
  }

  const aiocrPlan: AiocrPlanId = withAiocr
    ? (AIOCR_PLANS[payload.aiocrPlan as AiocrPlanId] ? (payload.aiocrPlan as AiocrPlanId) : 'standard')
    : 'lite';

  // メルマガは tier1 固定スタート。マイページでメーリスにメンバー追加すると自動でプラン昇格
  const merumagaPlan = MERUMAGA_PLANS.tier1;

  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, { ...options, ...AUTH_COOKIE_OPTIONS })
          );
        },
      },
    }
  );

  const { data: { user: existingUser } } = await supabase.auth.getUser();

  const service = createServiceClient();
  let userId: string;
  let userEmail: string;
  let createdNewUser = false;

  if (existingUser) {
    userId = existingUser.id;
    userEmail = existingUser.email ?? '';
  } else {
    if (!payload.email?.trim() || !payload.password) {
      return NextResponse.json(
        { error: 'メールアドレスとパスワードを入力してください' },
        { status: 400 }
      );
    }
    if (payload.password.length < 8) {
      return NextResponse.json({ error: 'パスワードは8文字以上' }, { status: 400 });
    }
    const { data: created, error: createErr } = await service.auth.admin.createUser({
      email: payload.email.trim(),
      password: payload.password,
      email_confirm: true,
      user_metadata: { company_name: companyName, contact_name: contactName },
    });
    if (createErr || !created.user) {
      if (createErr?.message?.toLowerCase().includes('already')) {
        return NextResponse.json(
          { error: 'このメールアドレスは既に登録されています。ログインしてください。' },
          { status: 409 }
        );
      }
      return NextResponse.json(
        { error: createErr?.message || 'アカウント作成に失敗しました' },
        { status: 500 }
      );
    }
    userId = created.user.id;
    userEmail = created.user.email ?? payload.email.trim();
    createdNewUser = true;

    // 即時サインイン（cookieセット）
    const { error: signInErr } = await supabase.auth.signInWithPassword({
      email: userEmail,
      password: payload.password,
    });
    if (signInErr) {
      console.error('post-signup signin failed:', signInErr);
    }
  }

  const notesParts = [
    `会社名: ${companyName}`,
    `担当者: ${contactName}`,
    phone ? `電話: ${phone}` : null,
  ].filter(Boolean);

  // AIOCR サブスク（subscriptions 行を upsert）
  if (withAiocr) {
    const { data: existingSub } = await service
      .from('subscriptions')
      .select('id, status')
      .eq('user_id', userId)
      .maybeSingle();
    const aiocrNotes = `${notesParts.join(' / ')} / プラン: ${aiocrPlan}`;
    if (existingSub) {
      await service
        .from('subscriptions')
        .update({
          plan: aiocrPlan,
          status: 'active',
          payment_method: 'bank_transfer',
          notes: aiocrNotes,
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', userId);
    } else {
      await service.from('subscriptions').insert({
        user_id: userId,
        email: userEmail,
        plan: aiocrPlan,
        status: 'active',
        payment_method: 'bank_transfer',
        notes: aiocrNotes,
      });
    }
  }

  // メルマガ事務所登録（firms 行を upsert）
  if (withMerumaga) {
    const { data: existingFirm } = await service
      .from('firms')
      .select('id, resend_audience_id')
      .eq('user_id', userId)
      .maybeSingle();

    // Resend Audience（メーリス）を未作成なら自動作成
    let audienceId = existingFirm?.resend_audience_id ?? null;
    if (!audienceId) {
      audienceId = await createMerumagaAudience(companyName);
    }

    if (existingFirm) {
      await service
        .from('firms')
        .update({
          name: companyName,
          contact_name: contactName,
          phone: phone || null,
          member_count: 0,
          plan: merumagaPlan.id,
          monthly_fee: merumagaPlan.price,
          status: 'active',
          payment_method: 'bank_transfer',
          resend_audience_id: audienceId,
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', userId);
    } else {
      await service.from('firms').insert({
        user_id: userId,
        name: companyName,
        contact_name: contactName,
        phone: phone || null,
        member_count: 0,
        plan: merumagaPlan.id,
        monthly_fee: merumagaPlan.price,
        status: 'active',
        payment_method: 'bank_transfer',
        resend_audience_id: audienceId,
      });
    }
  }

  // 請求書 PDF 発行（サービスごとに1通ずつ）。失敗しても申込自体は成功扱い
  // 失敗時は ADMIN_EMAIL に詳細を送って気付けるようにする。
  try {
    if (withAiocr) {
      const plan = AIOCR_PLANS[aiocrPlan];
      await issueAndSendInvoice({
        userId,
        userEmail,
        service: 'aiocr',
        itemName: `Invoice OCR ${plan.name}プラン（初月分）`,
        priceInclTax: plan.price,
        issuedToName: companyName,
        issuedToContact: contactName,
      });
    }
    if (withMerumaga) {
      await issueAndSendInvoice({
        userId,
        userEmail,
        service: 'merumaga',
        itemName: `税理士事務所スタッフ育成メルマガ ${merumagaPlan.name}プラン（初月分）`,
        priceInclTax: merumagaPlan.price,
        issuedToName: companyName,
        issuedToContact: contactName,
      });
    }
  } catch (e) {
    const detail = e instanceof Error ? `${e.message}\n${e.stack}` : String(e);
    console.error('invoice issue failed:', detail);
    // 管理者に通知（primary が落ちていても backup で送る）
    const adminEmail = process.env.ADMIN_EMAIL;
    if (adminEmail) {
      try {
        const r = await resendSendEmail({
          from: 'システムエラー <info@taxbestsearch.com>',
          to: adminEmail,
          subject: `【要対応】請求書発行失敗: ${userEmail}`,
          html: `<p>請求書発行に失敗しました。手動対応を検討してください。</p>
<ul>
<li>ユーザー: ${userEmail}</li>
<li>会社名: ${companyName}</li>
<li>aiocr: ${withAiocr ? aiocrPlan : '-'}</li>
<li>merumaga: ${withMerumaga ? merumagaPlan.id : '-'}</li>
<li>backup key 使用: ${'?'} (詳細はログ参照)</li>
</ul>
<pre style="background:#f5f5f5;padding:8px;font-size:11px;overflow:auto">${detail.replace(/[<>&]/g, (c) => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]!))}</pre>`,
        });
        if (!r.ok) console.error('admin notify (invoice fail) returned not-ok:', r.error);
      } catch (notifyErr) {
        console.error('admin notify (invoice fail) also failed:', notifyErr);
      }
    }
  }

  // 管理者通知（失敗してもサインアップ自体は成功扱い）
  try {
    await sendAdminNotification({
      email: userEmail,
      companyName,
      contactName,
      phone,
      withAiocr,
      aiocrPlan,
      withMerumaga,
      createdNewUser,
    });
  } catch (e) {
    console.error('admin notify failed:', e);
  }

  // メルマガ申込時は配信メーリスの設定画面へ直接誘導（最初にやることが明確になる）
  const redirectTo = withMerumaga
    ? 'https://mail.taxbestsearch.com/dashboard/members?welcome=1'
    : '/mypage';
  return NextResponse.json({ success: true, redirect: redirectTo });
}

async function sendAdminNotification(p: {
  email: string;
  companyName: string;
  contactName: string;
  phone?: string;
  withAiocr: boolean;
  aiocrPlan: AiocrPlanId;
  withMerumaga: boolean;
  createdNewUser: boolean;
}) {
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!adminEmail) return;
  const services: string[] = [];
  if (p.withAiocr) services.push(`Invoice OCR（${AIOCR_PLANS[p.aiocrPlan].name}・¥${AIOCR_PLANS[p.aiocrPlan].price.toLocaleString()}/月）`);
  if (p.withMerumaga) {
    const initial = MERUMAGA_PLANS.tier1;
    services.push(`育成メルマガ（${initial.name}スタート・¥${initial.price.toLocaleString()}/月、メーリス追加で自動昇格）`);
  }
  const r = await resendSendEmail({
    from: '申込通知 <info@taxbestsearch.com>',
    to: adminEmail,
    subject: `【申込】${p.companyName}（${services.length}サービス・${p.createdNewUser ? '新規' : '既存'}）`,
    html: `<p>申込が入りました（${p.createdNewUser ? '新規ユーザー' : '既存ユーザー追加申込'}）。</p>
      <ul>
        <li>会社名: ${p.companyName}</li>
        <li>担当者: ${p.contactName}</li>
        <li>電話: ${p.phone || '-'}</li>
        <li>メール: ${p.email}</li>
      </ul>
      <p>サービス:</p>
      <ul>${services.map((s) => `<li>${s}</li>`).join('')}</ul>
      <p>振込確認後、各サービスの管理画面で status を active に更新してください。</p>`,
  });
  if (!r.ok) console.error('admin notify failed:', r.error);
  if (r.usedBackup) console.warn('[resend] admin notify sent via BACKUP key');
}
