import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createServiceClient } from '@/utils/supabase/service';

export const maxDuration = 15;

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  const p = request.nextUrl.searchParams;
  const type = p.get('type') ?? 'ar';
  const clientId = p.get('clientId') || null;
  const status = p.get('status') || '';

  const service = createServiceClient();

  let q = service
    .from('ar_ap_records')
    .select('*, ar_ap_payments(id, payment_date, amount, notes, created_at)')
    .eq('user_id', user.id)
    .eq('type', type)
    .order('invoice_date', { ascending: false })
    .limit(500);

  if (clientId) q = q.eq('client_id', clientId);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = (data ?? []).map((r) => {
    const balance = Number(r.amount) - Number(r.paid_amount);
    let computedStatus: 'open' | 'partial' | 'paid';
    if (Number(r.paid_amount) <= 0) computedStatus = 'open';
    else if (balance > 0.01) computedStatus = 'partial';
    else computedStatus = 'paid';
    return { ...r, balance, computedStatus };
  });

  const filtered = status ? rows.filter((r) => r.computedStatus === status) : rows;

  const totalAmount = rows.reduce((s, r) => s + Number(r.amount), 0);
  const totalPaid = rows.reduce((s, r) => s + Number(r.paid_amount), 0);
  const totalOpen = rows.filter((r) => r.computedStatus !== 'paid').reduce((s, r) => s + r.balance, 0);

  return NextResponse.json({
    records: filtered,
    stats: { totalAmount, totalPaid, totalOpen, count: rows.length },
  });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  const body = await request.json();
  const { type, counterparty, invoice_date, due_date, amount, description, notes, client_id } = body;

  if (!type || !counterparty || !invoice_date || !amount) {
    return NextResponse.json({ error: '必須項目が不足しています' }, { status: 400 });
  }

  const service = createServiceClient();
  const { data, error } = await service
    .from('ar_ap_records')
    .insert({
      user_id: user.id,
      type,
      counterparty,
      invoice_date,
      due_date: due_date || null,
      amount: Number(amount),
      paid_amount: 0,
      description: description || null,
      notes: notes || null,
      client_id: client_id || null,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ record: data }, { status: 201 });
}
