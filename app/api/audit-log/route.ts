import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createServiceClient } from '@/utils/supabase/service';
import { listAccessibleClientIds, resolveClientScope } from '@/lib/client-access';

export const maxDuration = 15;

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const clientId = searchParams.get('clientId');
  const entryId = searchParams.get('entryId');
  const limit = Math.min(Number(searchParams.get('limit') ?? 100), 500);

  const service = createServiceClient();

  if (clientId) {
    const scope = await resolveClientScope(service, user.id, clientId);
    if (!scope) return NextResponse.json({ error: 'この会社へのアクセス権限がありません' }, { status: 403 });
    let query = service
      .from('journal_audit_logs')
      .select('id, entry_id, action, before_data, after_data, changed_at')
      .eq('user_id', scope.ownerUserId)
      .eq('client_id', clientId)
      .order('changed_at', { ascending: false })
      .limit(limit);
    if (entryId) query = query.eq('entry_id', entryId);
    const { data, error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ logs: data ?? [] });
  }

  // clientId 未指定: 個人 (caller の user_id + client_id null) と全アクセス可能 client を union
  const accessible = await listAccessibleClientIds(service, user.id);

  let personalQuery = service
    .from('journal_audit_logs')
    .select('id, entry_id, action, before_data, after_data, changed_at')
    .eq('user_id', user.id)
    .is('client_id', null)
    .order('changed_at', { ascending: false })
    .limit(limit);
  if (entryId) personalQuery = personalQuery.eq('entry_id', entryId);

  const personalRes = await personalQuery;
  let clientResData: Array<Record<string, unknown>> = [];

  if (accessible.length > 0) {
    let clientQuery = service
      .from('journal_audit_logs')
      .select('id, entry_id, action, before_data, after_data, changed_at')
      .in('client_id', accessible)
      .order('changed_at', { ascending: false })
      .limit(limit);
    if (entryId) clientQuery = clientQuery.eq('entry_id', entryId);
    const clientRes = await clientQuery;
    if (clientRes.error) return NextResponse.json({ error: clientRes.error.message }, { status: 500 });
    clientResData = clientRes.data ?? [];
  }

  if (personalRes.error) return NextResponse.json({ error: personalRes.error.message }, { status: 500 });

  const merged = [...(personalRes.data ?? []), ...clientResData];
  merged.sort((a, b) => String(b.changed_at ?? '').localeCompare(String(a.changed_at ?? '')));
  return NextResponse.json({ logs: merged.slice(0, limit) });
}
