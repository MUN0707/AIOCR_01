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
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const service = createServiceClient();
  const { data, error } = await service
    .from('error_reports')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // スクショの署名付きURLを生成
  const reports = await Promise.all(
    (data ?? []).map(async (r) => {
      let screenshotUrl: string | null = null;
      if (r.screenshot_path) {
        const { data: signed } = await service.storage
          .from('error-screenshots')
          .createSignedUrl(r.screenshot_path, 3600);
        screenshotUrl = signed?.signedUrl ?? null;
      }
      return { ...r, screenshot_url: screenshotUrl };
    })
  );

  return NextResponse.json({ reports });
}

export async function PATCH(request: NextRequest) {
  const admin = await verifyAdmin();
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { id, status } = await request.json();
  if (!id || !status) {
    return NextResponse.json({ error: 'id と status は必須です' }, { status: 400 });
  }
  if (!['open', 'in_progress', 'resolved'].includes(status)) {
    return NextResponse.json({ error: '不正な status です' }, { status: 400 });
  }

  const service = createServiceClient();
  const { error } = await service
    .from('error_reports')
    .update({ status })
    .eq('id', id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
