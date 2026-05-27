import { NextRequest, NextResponse } from "next/server";
import { getStripe, getStripeWebhookSecret } from "@/lib/stripe";
import { grantCredits, getCredits } from "@/lib/cost-control";
import { recordLedgerEntry } from "@/lib/credit-ledger";
import { getDb } from "@/lib/db";
import Stripe from "stripe";

/**
 * POST /api/billing/webhook
 *
 * Handles Stripe webhook events for payment processing, refunds,
 * and subscription lifecycle. Grants or deducts credits atomically
 * and records every change in the credit ledger.
 *
 * No Clerk auth — secured by Stripe webhook signature verification.
 */
export async function POST(req: NextRequest) {
  const body = await req.text();
  const signature = req.headers.get("stripe-signature");

  if (!signature) {
    return NextResponse.json(
      { error: "Missing stripe-signature header" },
      { status: 400 },
    );
  }

  let event: Stripe.Event;
  try {
    const stripe = getStripe();
    const secret = getStripeWebhookSecret();
    event = stripe.webhooks.constructEvent(body, signature, secret);
  } catch (err) {
    console.error("[Stripe Webhook] Signature verification failed", err);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed":
        await handleCheckoutCompleted(event.data.object);
        break;

      case "charge.refunded":
        await handleRefund(event.data.object);
        break;

      case "invoice.paid":
        await handleSubscriptionPayment(event.data.object);
        break;
    }

    return NextResponse.json({ received: true });
  } catch (err) {
    console.error("[Stripe Webhook] Handler error", err);
    // Return 200 so Stripe doesn't retry indefinitely; we log errors internally
    return NextResponse.json(
      { received: true, error: "Handler failed" },
      { status: 200 },
    );
  }
}

/** Check if a ledger entry already exists for the given reason + Stripe ID. */
async function isDuplicateLedgerEntry(
  stripeId: string,
  reason: string,
): Promise<boolean> {
  const db = getDb();
  const result = await db.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM credit_ledger
       WHERE stripe_session_id = $1 AND reason = $2
     ) AS "exists"`,
    [stripeId, reason],
  );
  return result.rows[0]?.exists ?? false;
}

async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  const userId = session.metadata?.userId;
  const credits = Number(session.metadata?.credits ?? "0");
  const packId = session.metadata?.packId ?? "unknown";
  const sessionId = session.id;

  if (!userId || credits <= 0) {
    console.error("[Stripe Webhook] Missing metadata in session", sessionId);
    return;
  }

  if (await isDuplicateLedgerEntry(sessionId, "purchase")) {
    console.log("[Stripe Webhook] Duplicate session, skipping", sessionId);
    return;
  }

  const newBalance = await grantCredits(userId, credits);

  await recordLedgerEntry({
    userId,
    amount: credits,
    balanceAfter: newBalance,
    reason: "purchase",
    stripeSessionId: sessionId,
    metadata: { packId, credits },
  });

  console.log(`[Stripe Webhook] Granted ${credits} credits to ${userId}`);
}

async function handleRefund(charge: Stripe.Charge) {
  const paymentIntent = charge.payment_intent as string;
  if (!paymentIntent) return;

  const stripe = getStripe();
  const sessions = await stripe.checkout.sessions.list({
    payment_intent: paymentIntent,
    limit: 1,
  });

  const session = sessions.data[0];
  if (!session) return;

  const userId = session.metadata?.userId;
  const credits = Number(session.metadata?.credits ?? "0");
  const sessionId = session.id;

  if (!userId || credits <= 0) return;

  if (await isDuplicateLedgerEntry(sessionId, "refund")) return;

  const currentBalance = await getCredits(userId);
  const deduction = Math.min(credits, currentBalance);

  if (deduction <= 0) return;

  // Atomic decrement of Redis credits (hot path)
  const { default: IORedis } = await import("ioredis");
  const redis = new IORedis(process.env.REDIS_URL || "redis://localhost:6379", {
    maxRetriesPerRequest: 1,
    lazyConnect: false,
  });
  const newBalance = await redis.decrby(`cost:credits:${userId}`, deduction);
  await redis.quit();

  await recordLedgerEntry({
    userId,
    amount: -deduction,
    balanceAfter: newBalance,
    reason: "refund",
    stripeSessionId: sessionId,
    metadata: { originalCredits: credits, deduction },
  });

  console.log(`[Stripe Webhook] Refunded ${deduction} credits from ${userId}`);
}

async function handleSubscriptionPayment(invoice: Stripe.Invoice) {
  // In Stripe SDK v22+, subscription is accessed via parent.subscription_details
  const parentSub = invoice.parent?.subscription_details?.subscription;
  const subscriptionId = typeof parentSub === "string" ? parentSub : null;

  if (!subscriptionId) return;

  const stripe = getStripe();
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);

  const userId = subscription.metadata?.userId;
  const monthlyCredits = Number(subscription.metadata?.monthlyCredits ?? "0");

  if (!userId || monthlyCredits <= 0) return;

  if (await isDuplicateLedgerEntry(invoice.id, "subscription_renewal")) return;

  const newBalance = await grantCredits(userId, monthlyCredits);

  await recordLedgerEntry({
    userId,
    amount: monthlyCredits,
    balanceAfter: newBalance,
    reason: "subscription_renewal",
    stripeSessionId: invoice.id,
    metadata: { subscriptionId: subscription.id, monthlyCredits },
  });

  console.log(
    `[Stripe Webhook] Subscription renewal: ${monthlyCredits} credits to ${userId}`,
  );
}
