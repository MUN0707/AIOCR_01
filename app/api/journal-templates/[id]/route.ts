import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createServiceClient } from '@/utils/supabase/service';

export const maxDuration = 15;

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  const service = createServiceClient();
  const { error } = await service
    .from('journal_templates')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}

// テンプレートから仕訳を起票する
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  const body = await request.json();
  const { entry_date, amount, description } = body;
  if (!entry_date) return NextResponse.json({ error: '日付は必須です' }, { status: 400 });

  const service = createServiceClient();
  const { data: tmpl, error: tmplErr } = await service
    .from('journal_templates')
    .select('*')
    .eq('id', id)
    .eq('user_id', user.id)
    .single();

  if (tmplErr || !tmpl) return NextResponse.json({ error: '対象テンプレートが見つかりません' }, { status: 404 });

  const entryDate = entry_date.replace(/-/g, '');
  const finalAmount = amount ? Number(amount) : Number(tmpl.amount ?? 0);

  const { data: entry, error: entErr } = await service
    .from('journal_entries')
    .insert({
      user_id: user.id,
      client_id: tmpl.client_id,
      entry_date: entryDate,
      debit_account: tmpl.debit_account,
      credit_account: tmpl.credit_account,
      amount: finalAmount,
      description: description || tmpl.description || null,
      tax_category: tmpl.tax_category || null,
    })
    .select('id, entry_date, debit_account, credit_account, amount, description')
    .single();

  if (entErr) return NextResponse.json({ error: entErr.message }, { status: 500 });
  return NextResponse.json({ entry }, { status: 201 });
}
