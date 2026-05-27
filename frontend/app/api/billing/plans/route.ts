import { NextResponse } from "next/server";
import { SUBSCRIPTION_PLANS } from "@/lib/credit-packs";

/**
 * GET /api/billing/plans
 *
 * Returns available subscription plans for the storefront.
 * Public endpoint — no auth required.
 */
export async function GET() {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const plans = SUBSCRIPTION_PLANS.map(({ stripePriceId, ...rest }) => rest);
  return NextResponse.json({ plans });
}
