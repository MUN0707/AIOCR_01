import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createServiceClient } from '@/utils/supabase/service';

export const maxDuration = 15;

// 初回ログイン時に投入するデフォルト科目（name + ローマ字読み + 大区分 + 中区分）
const DEFAULT_ACCOUNTS: { name: string; reading: string; category: string; sub_category: string }[] = [
  { name: '仕入高', reading: 'shiiredaka', category: 'expense', sub_category: '売上原価' },
  { name: '外注費', reading: 'gaichuhi', category: 'expense', sub_category: '売上原価' },
  { name: '業務委託費', reading: 'gyoumuitakuhi', category: 'expense', sub_category: '売上原価' },
  { name: '支払手数料', reading: 'shiharaitesuryo', category: 'expense', sub_category: '販管費' },
  { name: '通信費', reading: 'tsushinhi', category: 'expense', sub_category: '販管費' },
  { name: '旅費交通費', reading: 'ryohikoutsuhi', category: 'expense', sub_category: '販管費' },
  { name: '消耗品費', reading: 'shomohinhi', category: 'expense', sub_category: '販管費' },
  { name: '会議費', reading: 'kaigihi', category: 'expense', sub_category: '販管費' },
  { name: '接待交際費', reading: 'settaikoseihi', category: 'expense', sub_category: '販管費' },
  { name: '広告宣伝費', reading: 'kokokusendenhi', category: 'expense', sub_category: '販管費' },
  { name: '水道光熱費', reading: 'suidokonetsuhi', category: 'expense', sub_category: '販管費' },
  { name: '租税公課', reading: 'sozeikoka', category: 'expense', sub_category: '販管費' },
  { name: '雑費', reading: 'zappi', category: 'expense', sub_category: '販管費' },
  { name: '地代家賃', reading: 'chidaiyachin', category: 'expense', sub_category: '販管費' },
  { name: '給料手当', reading: 'kyuryoteate', category: 'expense', sub_category: '販管費' },
  { name: '法定福利費', reading: 'hoteifukurihi', category: 'expense', sub_category: '販管費' },
  { name: '減価償却費', reading: 'genkashokyakuhi', category: 'expense', sub_category: '販管費' },
  { name: '支払利息', reading: 'shiharairisoku', category: 'expense', sub_category: '営業外費用' },
  { name: '雑損失', reading: 'zasshitsu', category: 'expense', sub_category: '営業外費用' },
  { name: '受取利息', reading: 'uketoririsoku', category: 'revenue', sub_category: '営業外収益' },
  { name: '雑収入', reading: 'zasshunyu', category: 'revenue', sub_category: '営業外収益' },
  { name: '未払費用', reading: 'miharaihiyou', category: 'liability', sub_category: '流動負債' },
  { name: '未払金', reading: 'miharaikin', category: 'liability', sub_category: '流動負債' },
  { name: '買掛金', reading: 'kaikakekin', category: 'liability', sub_category: '流動負債' },
  { name: '普通預金', reading: 'futsuyokin', category: 'asset', sub_category: '流動資産' },
  { name: '当座預金', reading: 'tozayokin', category: 'asset', sub_category: '流動資産' },
  { name: '現金', reading: 'genkin', category: 'asset', sub_category: '流動資産' },
  { name: '売掛金', reading: 'urikakekin', category: 'asset', sub_category: '流動資産' },
  { name: '売上高', reading: 'uriagedaka', category: 'revenue', sub_category: '売上高' },
];

async function ensureDefaults(service: ReturnType<typeof createServiceClient>, userId: string) {
  const { count } = await service
    .from('accounts')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId);
  if ((count ?? 0) > 0) return;
  await service
    .from('accounts')
    .insert(DEFAULT_ACCOUNTS.map((a) => ({ ...a, user_id: userId })));
}

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  const service = createServiceClient();
  await ensureDefaults(service, user.id);

  const { data, error } = await service
    .from('accounts')
    .select('id, name, reading, category, sub_category, display_order')
    .eq('user_id', user.id)
    .order('display_order', { ascending: true })
    .order('name', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ accounts: data ?? [] });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  const body = await request.json();
  const name: string = (body.name ?? '').trim();
  const reading: string = (body.reading ?? '').trim().toLowerCase();
  const category: string = (body.category ?? '').trim();
  const sub_category: string = (body.sub_category ?? '').trim();

  if (!name) return NextResponse.json({ error: '科目名を入力してください' }, { status: 400 });
  if (name.length > 60) return NextResponse.json({ error: '科目名が長すぎます' }, { status: 400 });

  const service = createServiceClient();
  const { data, error } = await service
    .from('accounts')
    .insert({ user_id: user.id, name, reading, category, sub_category: sub_category || null })
    .select('id, name, reading, category, sub_category, display_order')
    .single();

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: '同じ名前の科目が既にあります' }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ account: data });
}
