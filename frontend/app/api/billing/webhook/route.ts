import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { addCredits } from '@/lib/credits'; // We may need to create or extend this

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2024-11-20.acacia',
});

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!;

/**
 * POST /api/billing/webhook
 *
 * Stripe sends events here for payment success, refunds, subscription changes, etc.
 * This is the core of T05.
 */
export async function POST(req: NextRequest) {
  const body = await req.text();
  const signature = req.headers.get('stripe-signature')!;

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (err: any) {
    console.error('Webhook signature verification failed:', err.message);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        await handleCheckoutSessionCompleted(session);
        break;
      }

      case 'charge.refunded': {
        const charge = event.data.object as Stripe.Charge;
        await handleRefund(charge);
        break;
      }

      case 'invoice.paid': {
        const invoice = event.data.object as Stripe.Invoice;
        await handleSubscriptionPayment(invoice);
        break;
      }

      // Add more events as needed (subscription canceled, etc.)
      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    return NextResponse.json({ received: true });
  } catch (err: any) {
    console.error('Webhook handler error:', err);
    // Return 200 so Stripe doesn't retry excessively while we fix
    return NextResponse.json({ error: 'Processing failed' }, { status: 200 });
  }
}

async function handleCheckoutSessionCompleted(session: Stripe.Checkout.Session) {
  const userId = session.metadata?.userId;
  const creditAmount = session.metadata?.creditAmount ? parseInt(session.metadata.creditAmount) : 0;

  if (!userId || !creditAmount) {
    console.warn('Missing userId or creditAmount in checkout session metadata');
    return;
  }

  // Add credits to the user's balance using the existing ledger system
  // TODO: Make sure we have an atomic `addCredits` that works with the cost-control ledger
  console.log(`Adding ${creditAmount} credits to user ${userId} from checkout ${session.id}`);

  // Placeholder - in real impl call your credit ledger
  // await addCredits(userId, creditAmount, `stripe-checkout:${session.id}`);
}

async function handleRefund(charge: Stripe.Charge) {
  // Handle partial or full refunds by deducting credits
  console.log('Refund received for charge:', charge.id);
  // TODO: Implement credit deduction on refund
}

async function handleSubscriptionPayment(invoice: Stripe.Invoice) {
  // Handle recurring subscription payments (monthly credit top-ups)
  console.log('Subscription invoice paid:', invoice.id);
  // TODO: Add recurring credits on successful subscription payment
}
