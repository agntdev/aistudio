import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { getCredits } from '@/lib/cost-control';
import { FREE_TIER_CREDITS } from '@/lib/credit-packs';
import { hasReceivedFreeTier } from '@/lib/credit-ledger';

/**
 * GET /api/billing/credits
 *
 * Returns the current user's credit balance and free tier status.
 * Requires Clerk authentication.
 */
export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const credits = await getCredits(userId);
  const freeTierClaimed = await hasReceivedFreeTier(userId);

  return NextResponse.json({
    credits,
    freeTierClaimed,
    freeTierCredits: FREE_TIER_CREDITS,
  });
}
