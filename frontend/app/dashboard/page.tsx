import { auth, currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { UserButton } from "@clerk/nextjs";
import Link from "next/link";
import { SafetyPanel } from "@/components/SafetyPanel";
import { getCredits } from "@/lib/cost-control";
import { FREE_TIER_CREDITS } from "@/lib/credit-packs";

export default async function Dashboard() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const user = await currentUser();
  const credits = await getCredits(userId);

  return (
    <div className="min-h-screen bg-zinc-950 text-white p-8">
      <div className="max-w-5xl mx-auto">
        <div className="flex justify-between items-center mb-10">
          <h1 className="text-3xl font-semibold tracking-tight">Dashboard</h1>
          <UserButton />
        </div>

        <div className="rounded-2xl border border-white/10 bg-zinc-900 p-8">
          <p className="text-zinc-400 mb-2">Welcome back,</p>
          <h2 className="text-4xl font-semibold tracking-tight mb-8">
            {user?.firstName || "Creator"}
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="rounded-xl border border-white/10 p-6">
              <div className="text-sm text-zinc-500">Models trained</div>
              <div className="text-5xl font-semibold mt-3 tabular-nums">0</div>
            </div>
            <div className="rounded-xl border border-white/10 p-6">
              <div className="text-sm text-zinc-500">Credits</div>
              <div className="text-5xl font-semibold mt-3 tabular-nums">
                {credits}
              </div>
            </div>
            <div className="rounded-xl border border-white/10 p-6">
              <div className="text-sm text-zinc-500">Free tier</div>
              <div className="text-5xl font-semibold mt-3 tabular-nums">
                {FREE_TIER_CREDITS}
              </div>
            </div>
          </div>

          <div className="mt-10 flex flex-wrap items-center justify-between gap-4">
            <Link
              href="/train"
              className="inline-flex h-11 items-center justify-center rounded-md bg-white px-8 text-sm font-medium text-black transition-colors hover:bg-zinc-200"
            >
              Start new training — upload selfies
            </Link>
            <div className="flex items-center gap-3">
              <Link
                href="/billing"
                className="inline-flex h-11 items-center justify-center rounded-md border border-white/20 px-6 text-sm font-medium text-white transition-colors hover:bg-white/10"
              >
                Buy credits
              </Link>
              <Link
                href="/gallery"
                className="rounded-lg border border-white/15 px-3 py-1.5 text-sm text-white transition-colors hover:border-white/40"
              >
                Open gallery →
              </Link>
            </div>
          </div>

          <div className="mt-12">
            <h3 className="font-semibold tracking-tight mb-4 text-lg">
              Safety & Moderation (T06)
            </h3>
            <SafetyPanel />
          </div>
        </div>
      </div>
    </div>
  );
}
