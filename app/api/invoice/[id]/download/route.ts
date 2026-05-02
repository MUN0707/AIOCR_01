import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/utils/supabase/service';
import { AUTH_COOKIE_OPTIONS } from '@/utils/supabase/cookie-options';

export const runtime = 'nodejs';

// 請求書 PDF をユーザー本人にだけ返す。
// invoices テーブルの user_id と現在ログイン中ユーザーが一致した場合のみ Storage から取得。
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll(); },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, { ...options, ...AUTH_COOKIE_OPTIONS })
          );
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const service = createServiceClient();
  const { data: invoice } = await service
    .from('invoices')
    .select('id, user_id, invoice_no, pdf_path')
    .eq('id', id)
    .maybeSingle();
  if (!invoice || invoice.user_id !== user.id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  if (!invoice.pdf_path) {
    return NextResponse.json({ error: 'PDF not generated' }, { status: 404 });
  }

  const { data: blob, error: dlErr } = await service.storage.from('invoices').download(invoice.pdf_path);
  if (dlErr || !blob) {
    return NextResponse.json({ error: dlErr?.message || 'download failed' }, { status: 500 });
  }
  const buffer = Buffer.from(await blob.arrayBuffer());
  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${invoice.invoice_no}.pdf"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
