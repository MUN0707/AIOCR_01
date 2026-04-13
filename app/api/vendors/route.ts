import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createServiceClient } from '@/utils/supabase/service';
import { normalizeVendorKey } from '@/lib/vendor-normalize';

export const maxDuration = 15;

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  const service = createServiceClient();
  const { data, error } = await service
    .from('vendors')
    .select('id, name, normalized_key, reading')
    .eq('user_id', user.id)
    .order('name', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ vendors: data ?? [] });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  const body = await request.json();
  const name: string = (body.name ?? '').trim();
  const reading: string = (body.reading ?? '').trim().toLowerCase();
  if (!name) return NextResponse.json({ error: '取引先名を入力してください' }, { status: 400 });
  if (name.length > 100) return NextResponse.json({ error: '取引先名が長すぎます' }, { status: 400 });

  const key = normalizeVendorKey(name);
  if (!key) return NextResponse.json({ error: '正規化キーが空になります' }, { status: 400 });

  const service = createServiceClient();

  // 既存に同一キーがあれば返却（重複作成を抑止）
  const { data: existing } = await service
    .from('vendors')
    .select('id, name, normalized_key, reading')
    .eq('user_id', user.id)
    .eq('normalized_key', key)
    .limit(1);

  if (existing && existing.length > 0) {
    return NextResponse.json({ vendor: existing[0], existed: true });
  }

  const { data, error } = await service
    .from('vendors')
    .insert({ user_id: user.id, name, normalized_key: key, reading })
    .select('id, name, normalized_key, reading')
    .single();

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: '同じ取引先が既にあります' }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ vendor: data });
}
