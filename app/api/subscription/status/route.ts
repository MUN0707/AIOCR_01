import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { isAdmin } from '@/lib/auth-admin';

export async function GET() {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // 管理者は常に active 扱い
  if (await isAdmin(user)) {
    return NextResponse.json({
      subscription: { status: 'active', email: user.email },
    });
  }

  const { data: subscription } = await supabase
    .from('subscriptions')
    .select('*')
    .eq('user_id', user.id)
    .single();

  return NextResponse.json({ subscription });
}
