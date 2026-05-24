import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * 指定 user が指定 client にアクセス可能か。
 * owner 本人 OR 承諾済み member であれば true。
 *
 * service_role 経由で呼ぶ前提（RLS bypass）。auth.uid() に依存しない。
 */
export async function userHasClientAccess(
  service: SupabaseClient,
  userId: string,
  clientId: string,
): Promise<boolean> {
  const { data, error } = await service.rpc('user_has_client_access', {
    p_user_id: userId,
    p_client_id: clientId,
  });
  if (error) return false;
  return data === true;
}

export type ClientRole = 'owner' | 'approver' | 'entry' | 'viewer';

/**
 * 指定 user の指定 client における role を返す。
 * 該当無し（access なし）は null。owner は常に 'owner'。
 */
export async function userClientRole(
  service: SupabaseClient,
  userId: string,
  clientId: string,
): Promise<ClientRole | null> {
  const { data, error } = await service.rpc('user_client_role', {
    p_user_id: userId,
    p_client_id: clientId,
  });
  if (error || !data) return null;
  return data as ClientRole;
}

/**
 * 書き込み権限の判定。viewer は読み取りのみ。
 */
export function canWrite(role: ClientRole | null): boolean {
  return role === 'owner' || role === 'approver' || role === 'entry';
}

/**
 * 承認権限の判定。owner / approver のみ。
 */
export function canApprove(role: ClientRole | null): boolean {
  return role === 'owner' || role === 'approver';
}

/**
 * user がアクセス可能な全 client_id を返す。
 * owner 持ち + 承諾済み member 持ち の和集合。
 */
export async function listAccessibleClientIds(
  service: SupabaseClient,
  userId: string,
): Promise<string[]> {
  const [ownerRes, memberRes] = await Promise.all([
    service.from('clients').select('id').eq('user_id', userId),
    service
      .from('client_members')
      .select('client_id')
      .eq('member_user_id', userId)
      .not('accepted_at', 'is', null),
  ]);
  const ids = new Set<string>();
  for (const r of ownerRes.data ?? []) ids.add(r.id);
  for (const r of memberRes.data ?? []) ids.add(r.client_id);
  return [...ids];
}

export interface ClientScope {
  ownerUserId: string;
  role: ClientRole;
}

/**
 * client へのアクセススコープを解決する。
 * 戻り値の ownerUserId をクエリの user_id フィルタに使う。
 * caller が owner → 自身、member → 真の owner、アクセス無し → null。
 */
export async function resolveClientScope(
  service: SupabaseClient,
  callingUserId: string,
  clientId: string,
): Promise<ClientScope | null> {
  const { data: client } = await service
    .from('clients')
    .select('user_id')
    .eq('id', clientId)
    .single();
  if (!client?.user_id) return null;

  if (client.user_id === callingUserId) {
    return { ownerUserId: callingUserId, role: 'owner' };
  }

  const { data: member } = await service
    .from('client_members')
    .select('role, accepted_at')
    .eq('client_id', clientId)
    .eq('member_user_id', callingUserId)
    .single();

  if (!member?.accepted_at) return null;
  return { ownerUserId: client.user_id, role: member.role as ClientRole };
}

/**
 * user の全アクセス可能 client について (ownerUserId → clientIds[]) のマップを返す。
 * clientId 未指定の API で、全 client 横断クエリを組むときに使う。
 */
export async function ownerScopedClientGroups(
  service: SupabaseClient,
  userId: string,
): Promise<Map<string, string[]>> {
  const accessible = await listAccessibleClientIds(service, userId);
  if (accessible.length === 0) return new Map();

  const { data } = await service
    .from('clients')
    .select('id, user_id')
    .in('id', accessible);

  const groups = new Map<string, string[]>();
  for (const c of data ?? []) {
    if (!c.user_id) continue;
    const arr = groups.get(c.user_id) ?? [];
    arr.push(c.id);
    groups.set(c.user_id, arr);
  }
  return groups;
}
