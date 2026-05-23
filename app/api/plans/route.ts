import { NextResponse } from 'next/server';
import { getPlanLimits } from '@/lib/plan-limits';

export async function GET() {
  const limits = await getPlanLimits();
  return NextResponse.json({ limits });
}
