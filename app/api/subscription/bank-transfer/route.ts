import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/utils/supabase/service';

export async function POST(request: NextRequest) {
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
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { companyName, contactName } = await request.json();
  if (!companyName || !contactName) {
    return NextResponse.json({ error: '会社名と担当者名は必須です' }, { status: 400 });
  }

  const serviceClient = createServiceClient();
  const notes = `会社名: ${companyName} / 担当者: ${contactName}`;

  const { error } = await serviceClient
    .from('subscriptions')
    .update({
      status: 'pending',
      payment_method: 'bank_transfer',
      notes,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', user.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
