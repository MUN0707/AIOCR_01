import { createServiceClient } from '@/utils/supabase/service';

type PlanLimits = Record<string, number>;

const TTL_MS = 5 * 60 * 1000;
const FALLBACK: PlanLimits = { lite: 30, standard: 100, pro: 300, enterprise: 1000, trial: 10 };
const FALLBACK_LIMIT = 50;

let cache: { data: PlanLimits; loadedAt: number } | null = null;

export async function getPlanLimits(): Promise<PlanLimits> {
  if (cache && Date.now() - cache.loadedAt < TTL_MS) return cache.data;
  const service = createServiceClient();
  const { data, error } = await service
    .from('plans')
    .select('plan_key, monthly_limit');
  if (error || !data || data.length === 0) {
    return FALLBACK;
  }
  const out: PlanLimits = {};
  for (const row of data as { plan_key: string; monthly_limit: number }[]) {
    out[row.plan_key] = row.monthly_limit;
  }
  cache = { data: out, loadedAt: Date.now() };
  return out;
}

export async function getPlanLimit(plan: string | null | undefined, status: string | null | undefined): Promise<number> {
  const limits = await getPlanLimits();
  const key = (status === 'active' ? plan : 'trial') ?? 'trial';
  return limits[key] ?? FALLBACK_LIMIT;
}
