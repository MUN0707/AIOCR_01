import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/utils/supabase/service';
import { createClient } from '@/utils/supabase/server';

export async function POST(request: NextRequest) {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { companyName, contactName, plan } = await request.json();
  if (!companyName || !contactName) {
    return NextResponse.json({ error: '会社名と担当者名は必須です' }, { status: 400 });
  }

  const validPlans = ['lite', 'standard', 'pro', 'enterprise'];
  const selectedPlan = validPlans.includes(plan) ? plan : 'standard';

  const serviceClient = createServiceClient();
  const notes = `会社名: ${companyName} / 担当者: ${contactName} / プラン: ${selectedPlan}`;

  const { error } = await serviceClient
    .from('subscriptions')
    .update({
      plan: selectedPlan,
      status: 'pending',
      payment_method: 'bank_transfer',
      notes,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', user.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
