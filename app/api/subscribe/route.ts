import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/utils/supabase/service';
import { AUTH_COOKIE_OPTIONS } from '@/utils/supabase/cookie-options';
import { AIOCR_PLANS, MERUMAGA_PLANS, type AiocrPlanId } from '@/lib/services';

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

// Resend Audience を自動作成（メルマガ申込時に1事務所＝1メーリス）
async function createMerumagaAudience(firmName: string): Promise<string | null> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error('RESEND_API_KEY missing - skip audience creation');
    return null;
  }
  try {
    const res = await fetch('https://api.resend.com/audiences', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: `merumaga / ${firmName}` }),
    });
    if (!res.ok) {
      console.error('Resend audience create failed:', res.status, await res.text());
      return null;
    }
    const data = (await res.json()) as { id?: string };
    return data.id ?? null;
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
          status: 'pending',
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
        status: 'pending',
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
          status: 'pending',
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
        status: 'pending',
        payment_method: 'bank_transfer',
        resend_audience_id: audienceId,
      });
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

  return NextResponse.json({ success: true, redirect: '/mypage' });
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
  const apiKey = process.env.RESEND_API_KEY;
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!apiKey || !adminEmail) return;
  const services: string[] = [];
  if (p.withAiocr) services.push(`Invoice OCR（${AIOCR_PLANS[p.aiocrPlan].name}・¥${AIOCR_PLANS[p.aiocrPlan].price.toLocaleString()}/月）`);
  if (p.withMerumaga) {
    const initial = MERUMAGA_PLANS.tier1;
    services.push(`育成メルマガ（${initial.name}スタート・¥${initial.price.toLocaleString()}/月、メーリス追加で自動昇格）`);
  }
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: '申込通知 <invoice-ocr@taxbestsearch.com>',
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
    }),
  });
}
