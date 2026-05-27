import { NextResponse } from "next/server";
import { CREDIT_PACKS } from "@/lib/credit-packs";

/**
 * GET /api/billing/packs
 *
 * Returns available credit packs for the storefront.
 * Public endpoint — no auth required (prices are public).
 */
export async function GET() {
  // Strip stripePriceId from public response — it's internal
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const packs = CREDIT_PACKS.map(({ stripePriceId, ...rest }) => rest);
  return NextResponse.json({ packs });
}
