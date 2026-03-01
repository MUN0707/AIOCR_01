import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/utils/supabase/service';

async function verifyAdmin() {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll(); },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        },
      },
    }
  );
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || user.email !== process.env.ADMIN_EMAIL) return null;
  return user;
}

export async function GET() {
  const admin = await verifyAdmin();
  if (!admin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const serviceClient = createServiceClient();
  const { data, error } = await serviceClient
    .from('subscriptions')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ subscriptions: data });
}

export async function PATCH(request: NextRequest) {
  const admin = await verifyAdmin();
  if (!admin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { id, action } = await request.json();
  if (!id || !action) {
    return NextResponse.json({ error: 'id と action は必須です' }, { status: 400 });
  }

  const serviceClient = createServiceClient();
  const now = new Date();

  if (action === 'activate') {
    const endDate = new Date(now);
    endDate.setMonth(endDate.getMonth() + 2);
    const { error } = await serviceClient
      .from('subscriptions')
      .update({
        status: 'active',
        subscription_start_at: now.toISOString(),
        subscription_end_at: endDate.toISOString(),
        updated_at: now.toISOString(),
      })
      .eq('id', id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else if (action === 'deactivate') {
    const { error } = await serviceClient
      .from('subscriptions')
      .update({ status: 'inactive', updated_at: now.toISOString() })
      .eq('id', id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else if (action === 'extend') {
    const { data: current, error: fetchError } = await serviceClient
      .from('subscriptions')
      .select('subscription_end_at')
      .eq('id', id)
      .single();
    if (fetchError) return NextResponse.json({ error: fetchError.message }, { status: 500 });

    const baseDate = current?.subscription_end_at
      ? new Date(current.subscription_end_at)
      : new Date(now);
    baseDate.setMonth(baseDate.getMonth() + 2);

    const { error } = await serviceClient
      .from('subscriptions')
      .update({
        status: 'active',
        subscription_end_at: baseDate.toISOString(),
        updated_at: now.toISOString(),
      })
      .eq('id', id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else {
    return NextResponse.json({ error: '不正な action です' }, { status: 400 });
  }

  return NextResponse.json({ success: true });
}
