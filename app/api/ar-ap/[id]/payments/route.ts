import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createServiceClient } from '@/utils/supabase/service';

export const maxDuration = 15;

// 消込明細を追加し、親レコードの paid_amount を再集計する
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  const body = await request.json();
  const { payment_date, amount, notes } = body;
  if (!payment_date || !amount) {
    return NextResponse.json({ error: '入金日と金額は必須です' }, { status: 400 });
  }

  const service = createServiceClient();

  // 親レコードの所有確認
  const { data: rec, error: recErr } = await service
    .from('ar_ap_records')
    .select('id, amount, paid_amount')
    .eq('id', id)
    .eq('user_id', user.id)
    .single();
  if (recErr || !rec) return NextResponse.json({ error: '対象レコードが見つかりません' }, { status: 404 });

  // 明細追加
  const { error: payErr } = await service
    .from('ar_ap_payments')
    .insert({ record_id: id, user_id: user.id, payment_date, amount: Number(amount), notes: notes || null });
  if (payErr) return NextResponse.json({ error: payErr.message }, { status: 500 });

  // paid_amount を全明細の合計で再計算
  const { data: payments } = await service
    .from('ar_ap_payments')
    .select('amount')
    .eq('record_id', id);
  const newPaid = (payments ?? []).reduce((s, p) => s + Number(p.amount), 0);

  const { data: updated, error: upErr } = await service
    .from('ar_ap_records')
    .update({ paid_amount: newPaid, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  return NextResponse.json({ record: updated }, { status: 201 });
}

// 消込明細を削除し paid_amount を再集計する
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  const body = await request.json();
  const paymentId = body.paymentId as string;
  if (!paymentId) return NextResponse.json({ error: 'paymentId が必要です' }, { status: 400 });

  const service = createServiceClient();

  const { error: delErr } = await service
    .from('ar_ap_payments')
    .delete()
    .eq('id', paymentId)
    .eq('user_id', user.id);
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });

  const { data: payments } = await service
    .from('ar_ap_payments')
    .select('amount')
    .eq('record_id', id);
  const newPaid = (payments ?? []).reduce((s, p) => s + Number(p.amount), 0);

  const { data: updated } = await service
    .from('ar_ap_records')
    .update({ paid_amount: newPaid, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();

  return NextResponse.json({ record: updated });
}
