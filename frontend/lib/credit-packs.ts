/**
 * Credit pack definitions (T05)
 *
 * Each pack maps to a Stripe price ID for the live/production environment.
 * In dev mode prices are created on-the-fly via the Stripe API.
 */

export interface CreditPack {
  id: string;
  name: string;
  credits: number;
  priceCents: number;
  stripePriceId: string;
  popular?: boolean;
}

export const CREDIT_PACKS: CreditPack[] = [
  {
    id: "pack_10",
    name: "10 Credits",
    credits: 10,
    priceCents: 499,
    stripePriceId: process.env.STRIPE_PRICE_10 ?? "price_10_credits",
    popular: false,
  },
  {
    id: "pack_25",
    name: "25 Credits",
    credits: 25,
    priceCents: 999,
    stripePriceId: process.env.STRIPE_PRICE_25 ?? "price_25_credits",
    popular: false,
  },
  {
    id: "pack_50",
    name: "50 Credits",
    credits: 50,
    priceCents: 1799,
    stripePriceId: process.env.STRIPE_PRICE_50 ?? "price_50_credits",
    popular: true,
  },
  {
    id: "pack_100",
    name: "100 Credits",
    credits: 100,
    priceCents: 2999,
    stripePriceId: process.env.STRIPE_PRICE_100 ?? "price_100_credits",
    popular: false,
  },
  {
    id: "pack_200",
    name: "200 Credits",
    credits: 200,
    priceCents: 4999,
    stripePriceId: process.env.STRIPE_PRICE_200 ?? "price_200_credits",
    popular: false,
  },
];

export const FREE_TIER_CREDITS = 10;

export function getPackById(id: string): CreditPack | undefined {
  return CREDIT_PACKS.find((p) => p.id === id);
}

// ----------------------------------------------------------------
// Subscription plans (T05 extension)
// ----------------------------------------------------------------

export interface SubscriptionPlan {
  id: string;
  name: string;
  monthlyCredits: number;
  priceCents: number;
  stripePriceId: string;
  popular?: boolean;
}

export const SUBSCRIPTION_PLANS: SubscriptionPlan[] = [
  {
    id: "sub_starter",
    name: "Starter",
    monthlyCredits: 50,
    priceCents: 999,
    stripePriceId: process.env.STRIPE_SUB_STARTER ?? "sub_starter_price",
  },
  {
    id: "sub_pro",
    name: "Pro",
    monthlyCredits: 200,
    priceCents: 2499,
    stripePriceId: process.env.STRIPE_SUB_PRO ?? "sub_pro_price",
    popular: true,
  },
  {
    id: "sub_max",
    name: "Max",
    monthlyCredits: 500,
    priceCents: 4999,
    stripePriceId: process.env.STRIPE_SUB_MAX ?? "sub_max_price",
  },
];

export function getPlanById(id: string): SubscriptionPlan | undefined {
  return SUBSCRIPTION_PLANS.find((p) => p.id === id);
}
