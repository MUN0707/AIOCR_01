import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';

const PLAN_LIMITS: Record<string, number> = {
  light: 50,
  heavy: 200,
  trial: 50,
};

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

  const plan = subscription?.plan ?? 'light';
  const status = subscription?.status ?? 'trial';
  const limit = PLAN_LIMITS[status === 'active' ? plan : 'trial'] ?? 50;
  const count = usage?.count ?? 0;

  return NextResponse.json({ count, limit, plan, status, yearMonth });
}
