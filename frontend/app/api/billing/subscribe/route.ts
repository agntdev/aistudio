import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getStripe } from "@/lib/stripe";
import { getPlanById } from "@/lib/credit-packs";

/**
 * POST /api/billing/subscribe
 *
 * Creates a Stripe Checkout Session for a monthly subscription plan.
 * Requires Clerk authentication — userId is sourced from the session,
 * never from the request body.
 */
export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let planId: string;
  try {
    const body = await req.json();
    planId = body.planId;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!planId || typeof planId !== "string") {
    return NextResponse.json({ error: "planId is required" }, { status: 400 });
  }

  const plan = getPlanById(planId);
  if (!plan) {
    return NextResponse.json(
      { error: `Unknown subscription plan: ${planId}` },
      { status: 400 },
    );
  }

  const origin =
    req.headers.get("origin") ??
    process.env.NEXT_PUBLIC_APP_URL ??
    "http://localhost:3000";

  try {
    const stripe = getStripe();

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: `${plan.name} Plan`,
              description: `${plan.monthlyCredits} credits/month for AIStudio image generation`,
            },
            unit_amount: plan.priceCents,
            recurring: {
              interval: "month",
            },
          },
          quantity: 1,
        },
      ],
      metadata: {
        userId,
        planId: plan.id,
        monthlyCredits: String(plan.monthlyCredits),
        type: "subscription",
      },
      subscription_data: {
        metadata: {
          userId,
          planId: plan.id,
          monthlyCredits: String(plan.monthlyCredits),
        },
      },
      success_url: `${origin}/billing?success=true&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/billing?canceled=true`,
    });

    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error("[Stripe Subscribe] Failed to create session", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
