"use client";

import { useState, useEffect } from "react";
import { useAuth, UserButton } from "@clerk/nextjs";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import type { CreditPack } from "@/lib/credit-packs";

/**
 * /billing — credit pack storefront + purchase flow.
 *
 * Shows available credit packs, current balance, and initiates
 * Stripe Checkout when a user clicks "Buy".
 */

export default function BillingPage() {
  const { isSignedIn, isLoaded } = useAuth();
  const searchParams = useSearchParams();
  const success = searchParams.get("success");
  const canceled = searchParams.get("canceled");

  const [packs, setPacks] = useState<CreditPack[]>([]);
  const [credits, setCredits] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/billing/packs")
      .then((r) => r.json())
      .then((data) => setPacks(data.packs ?? []))
      .catch(() => setPacks([]));

    fetch("/api/billing/credits")
      .then((r) => r.json())
      .then((data) => setCredits(data.credits ?? 0))
      .catch(() => setCredits(0));
  }, []);

  async function handleBuy(packId: string) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ packId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to create checkout");
      if (data.url) {
        window.location.href = data.url;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  if (!isLoaded) {
    return (
      <div className="min-h-screen bg-zinc-950 text-white flex items-center justify-center">
        <div className="animate-pulse text-zinc-500">Loading...</div>
      </div>
    );
  }

  if (!isSignedIn) {
    return (
      <div className="min-h-screen bg-zinc-950 text-white flex items-center justify-center">
        <div className="text-center">
          <p className="text-zinc-400 mb-4">Sign in to buy credits</p>
          <Link href="/">
            <Button>Back to home</Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-white p-8">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex justify-between items-center mb-10">
          <div>
            <Link href="/dashboard" className="text-sm text-zinc-400 hover:text-white transition mb-2 block">
              ← Back to dashboard
            </Link>
            <h1 className="text-3xl font-semibold tracking-tight">Buy Credits</h1>
          </div>
          <UserButton />
        </div>

        {/* Status messages */}
        {success === "true" && (
          <div className="mb-8 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-emerald-400">
            Payment successful! Credits have been added to your account.
          </div>
        )}
        {canceled === "true" && (
          <div className="mb-8 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-amber-400">
            Purchase was canceled. No charges were made.
          </div>
        )}
        {error && (
          <div className="mb-8 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-red-400">
            {error}
          </div>
        )}

        {/* Current balance */}
        <div className="mb-10 rounded-2xl border border-white/10 bg-zinc-900 p-8">
          <div className="flex items-baseline gap-3">
            <div className="text-sm text-zinc-500">Your balance</div>
            <div className="text-5xl font-semibold tabular-nums">
              {credits !== null ? credits : "—"}
            </div>
            <div className="text-zinc-400">credits</div>
          </div>
          <p className="mt-2 text-sm text-zinc-500">
            1 credit = 1 image generation. Credits never expire.
          </p>
        </div>

        {/* Credit packs */}
        <h2 className="text-xl font-semibold mb-6 tracking-tight">Credit Packs</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
          {packs.map((pack) => (
            <div
              key={pack.id}
              className={`relative rounded-2xl border p-6 flex flex-col ${
                pack.popular
                  ? "border-white/30 bg-white/5 ring-1 ring-white/20"
                  : "border-white/10 bg-zinc-900/50"
              }`}
            >
              {pack.popular && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-white px-3 py-0.5 text-xs font-medium text-black">
                  Popular
                </div>
              )}
              <div className="text-lg font-semibold mb-1">{pack.name}</div>
              <div className="text-3xl font-bold mt-4 mb-1">
                ${(pack.priceCents / 100).toFixed(2)}
              </div>
              <div className="text-sm text-zinc-400 mb-6">
                ${(pack.priceCents / pack.credits / 100).toFixed(2)}/credit
              </div>
              <button
                onClick={() => handleBuy(pack.id)}
                disabled={loading}
                className={`mt-auto w-full rounded-lg py-2.5 text-sm font-medium transition ${
                  pack.popular
                    ? "bg-white text-black hover:bg-zinc-200"
                    : "border border-white/20 hover:bg-white/10"
                } disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                {loading ? "Redirecting..." : "Buy"}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
