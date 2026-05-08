import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createServiceClient } from '@/utils/supabase/service';

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
  let query = service
    .from('journal_audit_logs')
    .select('id, entry_id, action, before_data, after_data, changed_at')
    .eq('user_id', user.id)
    .order('changed_at', { ascending: false })
    .limit(limit);

  if (entryId) query = query.eq('entry_id', entryId);
  if (clientId) query = query.eq('client_id', clientId);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ logs: data ?? [] });
}
