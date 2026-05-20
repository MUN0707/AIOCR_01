import type { User } from '@supabase/supabase-js';
import { createServiceClient } from '@/utils/supabase/service';

export async function isAdmin(user: Pick<User, 'id'> | null | undefined): Promise<boolean> {
  if (!user?.id) return false;
  const service = createServiceClient();
  const { data } = await service
    .from('aiocr_admins')
    .select('user_id')
    .eq('user_id', user.id)
    .maybeSingle();
  return !!data;
}
