import Link from "next/link";
import {
  SignInButton as ClerkSignInButton,
  SignUpButton as ClerkSignUpButton,
  UserButton as ClerkUserButton,
} from "@clerk/nextjs";
import { Button } from "@/components/ui/button";

// When no real Clerk publishable key is configured (local dev / demo)
// the @clerk/nextjs components throw because there's no ClerkProvider
// in the tree. Fall back to plain links so the marketing page still
// renders for showcases / screenshots.
const HAS_REAL_CLERK =
  !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY &&
  !process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY.endsWith("placeholder");

function SignInButton({ children }: { mode?: "modal"; children: React.ReactNode }) {
  if (!HAS_REAL_CLERK) return <Link href="/sign-in">{children}</Link>;
  return <ClerkSignInButton mode="modal">{children}</ClerkSignInButton>;
}

function SignUpButton({ children }: { mode?: "modal"; children: React.ReactNode }) {
  if (!HAS_REAL_CLERK) return <Link href="/sign-up">{children}</Link>;
  return <ClerkSignUpButton mode="modal">{children}</ClerkSignUpButton>;
}

function UserButton() {
  if (!HAS_REAL_CLERK) return null;
  return <ClerkUserButton />;
}

export default function AIStudioLanding() {
  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      {/* Nav */}
      <nav className="border-b border-white/10">
        <div className="max-w-7xl mx-auto flex h-16 items-center justify-between px-6">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-full bg-white" />
            <span className="font-semibold text-xl tracking-tight">AIStudio</span>
          </div>

          <div className="flex items-center gap-4">
            <Link href="#features" className="text-sm text-zinc-400 hover:text-white transition">Features</Link>
            <Link href="#how" className="text-sm text-zinc-400 hover:text-white transition">How it works</Link>
            <Link href="/dashboard" className="text-sm text-zinc-400 hover:text-white transition">Dashboard</Link>

            <div className="flex items-center gap-2 pl-4 border-l border-white/10">
              <SignInButton mode="modal">
                <Button variant="ghost" size="sm">Sign in</Button>
              </SignInButton>
              <SignUpButton mode="modal">
                <Button size="sm" className="bg-white text-black hover:bg-zinc-200">Get started free</Button>
              </SignUpButton>
              <UserButton />
            </div>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <div className="max-w-5xl mx-auto px-6 pt-24 pb-20 text-center">
        <div className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/5 px-4 py-1 text-xs tracking-[3px] mb-6">
          POWERED BY AI • TRAIN IN 15–25 MINUTES
        </div>

        <h1 className="text-7xl font-semibold tracking-tighter leading-none mb-6">
          Professional photoshoots.<br />Powered by your face.
        </h1>
        <p className="max-w-2xl mx-auto text-2xl text-zinc-400 mb-10">
          Upload 15–30 selfies. Train a custom model. Generate unlimited styled photoshoots in seconds.
        </p>

        <div className="flex justify-center gap-4">
          <SignUpButton mode="modal">
            <Button size="lg" className="h-14 px-10 text-lg bg-white text-black hover:bg-zinc-200">Start free trial</Button>
          </SignUpButton>
          <Link href="#how">
            <Button variant="outline" size="lg" className="h-14 px-10 text-lg border-white/30 hover:bg-white/5">See how it works</Button>
          </Link>
        </div>

        <p className="mt-4 text-xs text-zinc-500">No credit card required • 10 generations free</p>
      </div>

      {/* Trust bar */}
      <div className="border-y border-white/10 py-8">
        <div className="max-w-5xl mx-auto px-6 flex flex-wrap justify-center gap-x-12 gap-y-4 text-sm text-zinc-400">
          <div>Trusted by creators at</div>
          <div className="font-medium text-white">Vogue • OnlyFans creators • Influencers</div>
        </div>
      </div>

      {/* Features */}
      <div id="features" className="max-w-7xl mx-auto px-6 py-24 grid md:grid-cols-3 gap-8">
        {[
          { title: "Train in minutes", desc: "Upload selfies → our pipeline creates a high-quality LoRA in 15-25 min with face verification & NSFW filtering." },
          { title: "Unlimited styles", desc: "Hundreds of curated prompt packs: editorial, lifestyle, boudoir, vintage, cyberpunk, and more." },
          { title: "Full ownership", desc: "Your model stays private. Export weights anytime. One-time training, lifetime access." },
        ].map((f, i) => (
          <div key={i} className="rounded-2xl border border-white/10 bg-zinc-900/50 p-8">
            <div className="text-4xl mb-6 opacity-60">0{i+1}</div>
            <h3 className="text-2xl font-semibold mb-3 tracking-tight">{f.title}</h3>
            <p className="text-zinc-400 leading-relaxed">{f.desc}</p>
          </div>
        ))}
      </div>

      {/* How it works */}
      <div id="how" className="bg-zinc-900 py-20 border-y border-white/10">
        <div className="max-w-4xl mx-auto px-6">
          <h2 className="text-center text-4xl font-semibold tracking-tight mb-12">Three steps to your perfect photoshoot</h2>
          <div className="space-y-8 text-lg">
            {[
              ["1. Upload & Verify", "Private upload to S3. Real-time face liveness + NSFW detection."],
              ["2. Train your model", "We run optimized LoRA training. You get notified when ready (usually < 25 min)."],
              ["3. Generate", "Pick a prompt pack or write your own. Generate 8–32 images per credit pack."],
            ].map(([title, desc], idx) => (
              <div key={idx} className="flex gap-6">
                <div className="font-mono text-sm text-zinc-500 w-6 flex-shrink-0 mt-1">{String(idx+1).padStart(2, '0')}</div>
                <div>
                  <div className="font-medium text-white mb-1">{title}</div>
                  <div className="text-zinc-400">{desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Final CTA */}
      <div className="py-20 text-center border-b border-white/10">
        <h2 className="text-5xl font-semibold tracking-tight mb-4">Ready to look like a million bucks?</h2>
        <p className="text-xl text-zinc-400 mb-8">No expensive studio. No makeup artist. Just your phone and AIStudio.</p>
        <SignUpButton mode="modal">
          <Button size="lg" className="h-14 px-12 text-lg">Create your first model — free</Button>
        </SignUpButton>
      </div>

      <footer className="py-10 text-center text-xs text-zinc-500">
        © {new Date().getFullYear()} AIStudio • Built as part of the agnt bounty program
      </footer>
    </div>
  );
}
