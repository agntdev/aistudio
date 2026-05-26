import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2024-11-20.acacia',
});

/**
 * POST /api/billing/checkout
 *
 * Creates a Stripe Checkout session for credit packs or subscriptions.
 * This is the main entry point for users to buy credits.
 */
export async function POST(req: NextRequest) {
  try {
    const { userId, packId, mode = 'payment' } = await req.json();

    if (!userId) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 });
    }

    // Define credit packs (this can later come from DB or config)
    const creditPacks: Record<string, { credits: number; price: number; name: string }> = {
      starter:   { credits: 100,  price: 1000,  name: 'Starter Pack (100 credits)' },
      popular:   { credits: 500,  price: 4500,  name: 'Popular Pack (500 credits)' },
      pro:       { credits: 1200, price: 10000, name: 'Pro Pack (1200 credits)' },
    };

    let lineItems;
    let metadata: Record<string, string> = { userId };

    if (mode === 'subscription') {
      // Subscription example - monthly credit top-up
      lineItems = [{
        price_data: {
          currency: 'usd',
          product_data: { name: 'AIStudio Monthly Credits' },
          unit_amount: 1999, // $19.99 / month
          recurring: { interval: 'month' },
        },
        quantity: 1,
      }];
      metadata.type = 'subscription';
    } else {
      // One-time credit pack purchase
      const pack = creditPacks[packId as keyof typeof creditPacks];
      if (!pack) {
        return NextResponse.json({ error: 'Invalid pack' }, { status: 400 });
      }

      lineItems = [{
        price_data: {
          currency: 'usd',
          product_data: { name: pack.name },
          unit_amount: pack.price,
        },
        quantity: 1,
      }];

      metadata.creditAmount = pack.credits.toString();
      metadata.type = 'credit_pack';
      metadata.packId = packId;
    }

    const session = await stripe.checkout.sessions.create({
      mode: mode === 'subscription' ? 'subscription' : 'payment',
      payment_method_types: ['card'],
      line_items: lineItems,
      success_url: `${process.env.NEXT_PUBLIC_APP_URL}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/billing`,
      metadata,
      // For subscriptions, you can add customer creation etc.
    });

    return NextResponse.json({ url: session.url });
  } catch (err: any) {
    console.error('Checkout error:', err);
    return NextResponse.json({ error: 'Failed to create checkout session' }, { status: 500 });
  }
}
