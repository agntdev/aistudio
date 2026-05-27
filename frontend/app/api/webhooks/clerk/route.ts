import { NextRequest, NextResponse } from 'next/server';
import { Webhook } from 'svix';
import { grantCredits } from '@/lib/cost-control';
import { recordLedgerEntry, hasReceivedFreeTier } from '@/lib/credit-ledger';
import { FREE_TIER_CREDITS } from '@/lib/credit-packs';

/**
 * POST /api/webhooks/clerk
 *
 * Handles Clerk webhook events. On user.created, grants free tier credits
 * so new users can start generating immediately without payment.
 *
 * Secured by Svix webhook signature verification (Clerk's webhook provider).
 */
export async function POST(req: NextRequest) {
  const body = await req.text();
  const headers = {
    'svix-id': req.headers.get('svix-id') ?? '',
    'svix-timestamp': req.headers.get('svix-timestamp') ?? '',
    'svix-signature': req.headers.get('svix-signature') ?? '',
  };

  const secret = process.env.CLERK_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'CLERK_WEBHOOK_SECRET not configured' }, { status: 500 });
  }

  let event: { type: string; data: Record<string, unknown> };
  try {
    const wh = new Webhook(secret);
    event = wh.verify(body, headers) as { type: string; data: Record<string, unknown> };
  } catch {
    return NextResponse.json({ error: 'Invalid webhook signature' }, { status: 400 });
  }

  if (event.type === 'user.created') {
    await handleUserCreated(event.data);
  }

  return NextResponse.json({ received: true });
}

async function handleUserCreated(data: Record<string, unknown>) {
  const userId = data.id as string;
  if (!userId) return;

  // Idempotency: don't grant free tier twice
  const alreadyGranted = await hasReceivedFreeTier(userId);
  if (alreadyGranted) {
    console.log(`[Clerk Webhook] Free tier already granted to ${userId}, skipping`);
    return;
  }

  const newBalance = await grantCredits(userId, FREE_TIER_CREDITS);

  await recordLedgerEntry({
    userId,
    amount: FREE_TIER_CREDITS,
    balanceAfter: newBalance,
    reason: 'free_tier',
    metadata: { source: 'clerk_user_created' },
  });

  console.log(`[Clerk Webhook] Granted ${FREE_TIER_CREDITS} free tier credits to ${userId}`);
}
