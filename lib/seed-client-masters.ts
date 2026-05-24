import type { SupabaseClient } from '@supabase/supabase-js';

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

/**
 * 新規 client 作成直後に呼ぶ。
 * 1. seed_client_masters RPC で他 client から accounts/vendors/account_rules をコピー
 * 2. コピー元が無い（user 初の client）場合は DEFAULT_ACCOUNTS を投入
 */
export async function seedClientMasters(
  service: SupabaseClient,
  userId: string,
  clientId: string,
): Promise<void> {
  const { data: rpcResult } = await service.rpc('seed_client_masters', {
    p_client_id: clientId,
    p_source_client_id: null,
  });

  const seeded = rpcResult && typeof rpcResult === 'object' && (rpcResult as Record<string, unknown>).seeded === true;
  if (seeded) return;

  // ソース無し → DEFAULT_ACCOUNTS を投入
  await service
    .from('accounts')
    .insert(
      DEFAULT_ACCOUNTS.map((a) => ({
        ...a,
        user_id: userId,
        client_id: clientId,
        auto_registered: false,
        confirmed: true,
      })),
    );
}
