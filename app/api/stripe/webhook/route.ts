import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createServiceClient } from '@/utils/supabase/service';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

export async function POST(request: NextRequest) {
  const body = await request.text();
  const sig = request.headers.get('stripe-signature');

  if (!sig) {
    return NextResponse.json({ error: 'Missing stripe-signature' }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  const serviceClient = createServiceClient();
  const now = new Date();

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.CheckoutSession;
      const userId = session.metadata?.user_id;
      if (userId) {
        const endDate = new Date(now);
        endDate.setMonth(endDate.getMonth() + 1);
        await serviceClient
          .from('subscriptions')
          .update({
            status: 'active',
            payment_method: 'credit_card',
            stripe_customer_id: session.customer as string,
            stripe_subscription_id: session.subscription as string,
            subscription_start_at: now.toISOString(),
            subscription_end_at: endDate.toISOString(),
            updated_at: now.toISOString(),
          })
          .eq('user_id', userId);
      }
      break;
    }

    case 'invoice.payment_succeeded': {
      const invoice = event.data.object as Stripe.Invoice;
      const customerId = invoice.customer as string;
      const subId = invoice.subscription as string;
      if (subId) {
        const sub = await stripe.subscriptions.retrieve(subId);
        const endDate = new Date(sub.current_period_end * 1000);
        await serviceClient
          .from('subscriptions')
          .update({
            status: 'active',
            subscription_end_at: endDate.toISOString(),
            updated_at: now.toISOString(),
          })
          .eq('stripe_customer_id', customerId);
      }
      break;
    }

    case 'customer.subscription.deleted':
    case 'invoice.payment_failed': {
      const obj = event.data.object as Stripe.Subscription | Stripe.Invoice;
      const customerId = (obj as Stripe.Subscription).customer as string;
      await serviceClient
        .from('subscriptions')
        .update({ status: 'inactive', updated_at: now.toISOString() })
        .eq('stripe_customer_id', customerId);
      break;
    }
  }

  return NextResponse.json({ received: true });
}
