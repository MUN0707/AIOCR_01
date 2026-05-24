import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createServiceClient } from '@/utils/supabase/service';
import { canWrite, resolveClientScope } from '@/lib/client-access';

export const maxDuration = 15;

async function resolveTemplateScope(
  service: ReturnType<typeof createServiceClient>,
  callingUserId: string,
  id: string,
): Promise<{ ownerUserId: string; clientId: string | null; tmpl?: Record<string, unknown> } | { error: string; status: number }> {
  const { data: tmpl } = await service
    .from('journal_templates')
    .select('*')
    .eq('id', id)
    .single();
  if (!tmpl) return { error: '対象テンプレートが見つかりません', status: 404 };
  if (tmpl.client_id) {
    const scope = await resolveClientScope(service, callingUserId, tmpl.client_id);
    if (!scope || !canWrite(scope.role)) {
      return { error: 'このテンプレートの書き込み権限がありません', status: 403 };
    }
    return { ownerUserId: scope.ownerUserId, clientId: tmpl.client_id, tmpl };
  }
  if (tmpl.user_id !== callingUserId) {
    return { error: '対象テンプレートが見つかりません', status: 404 };
  }
  return { ownerUserId: callingUserId, clientId: null, tmpl };
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  const service = createServiceClient();
  const resolved = await resolveTemplateScope(service, user.id, id);
  if ('error' in resolved) return NextResponse.json({ error: resolved.error }, { status: resolved.status });

  const { error } = await service
    .from('journal_templates')
    .delete()
    .eq('id', id)
    .eq('user_id', resolved.ownerUserId);

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
  const resolved = await resolveTemplateScope(service, user.id, id);
  if ('error' in resolved) return NextResponse.json({ error: resolved.error }, { status: resolved.status });
  const tmpl = resolved.tmpl as {
    client_id: string | null;
    debit_account: string;
    credit_account: string;
    amount: number | null;
    description: string | null;
    tax_category: string | null;
  };

  const entryDate = entry_date.replace(/-/g, '');
  const finalAmount = amount ? Number(amount) : Number(tmpl.amount ?? 0);

  const { data: entry, error: entErr } = await service
    .from('journal_entries')
    .insert({
      user_id: resolved.ownerUserId,
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
