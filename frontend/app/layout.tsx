import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ClerkProvider } from "@clerk/nextjs";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "AIStudio — AI Photoshoot Generator",
  description:
    "Train custom AI models from your photos and generate professional styled photoshoots in minutes.",
  icons: {
    icon: "/favicon.ico",
  },
};

// Demo / local-dev escape hatch: when no real Clerk key is configured,
// skip ClerkProvider so the rest of the app renders without throwing
// "Publishable key not valid". Real keys are detected by the pk_test_
// or pk_live_ prefix and a non-placeholder suffix.
const HAS_REAL_CLERK =
  !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY &&
  !process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY.endsWith("placeholder");

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-zinc-950 text-zinc-50">
        {children}
      </body>
    </html>
  );
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  if (!HAS_REAL_CLERK) {
    return <Shell>{children}</Shell>;
  }
  return (
    <ClerkProvider>
      <Shell>{children}</Shell>
    </ClerkProvider>
  );
}
