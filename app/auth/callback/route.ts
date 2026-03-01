import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServiceClient } from '@/utils/supabase/service';

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/';

  if (code) {
    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          },
        },
      }
    );

    const { data: { user }, error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error && user) {
      // 管理者はサブスクリプション不要
      if (user.email !== process.env.ADMIN_EMAIL) {
        // 既存のサブスクリプションがなければ trial を作成
        const serviceClient = createServiceClient();
        const { data: existing } = await serviceClient
          .from('subscriptions')
          .select('id')
          .eq('user_id', user.id)
          .single();

        if (!existing) {
          const trialEndAt = new Date();
          trialEndAt.setDate(trialEndAt.getDate() + 3);
          await serviceClient.from('subscriptions').insert({
            user_id: user.id,
            email: user.email,
            status: 'trial',
            trial_start_at: new Date().toISOString(),
            trial_end_at: trialEndAt.toISOString(),
          });
        }
      }

      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth`);
}
