import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { getPlanLimit } from '@/lib/plan-limits';

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const yearMonth = new Date().toISOString().slice(0, 7);

  const [{ data: subscription }, { data: usage }] = await Promise.all([
    supabase
      .from('subscriptions')
      .select('plan, status')
      .eq('user_id', user.id)
      .single(),
    supabase
      .from('usage_logs')
      .select('count')
      .eq('user_id', user.id)
      .eq('year_month', yearMonth)
      .single(),
  ]);

  const plan = subscription?.plan ?? 'lite';
  const status = subscription?.status ?? 'trial';
  const limit = await getPlanLimit(plan, status);
  const count = usage?.count ?? 0;

  return NextResponse.json({ count, limit, plan, status, yearMonth });
}
