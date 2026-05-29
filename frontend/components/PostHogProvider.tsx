'use client';

/**
 * PostHog provider for the App Router (T08).
 *
 * Initialises the PostHog browser SDK once on mount, then tracks page
 * views explicitly because `posthog-js`'s autocapture is disabled by
 * design — the App Router doesn't fire the legacy `next/router`
 * `routeChangeComplete` event PostHog relies on.
 *
 * When `NEXT_PUBLIC_POSTHOG_KEY` is unset (local dev, previews) the
 * provider becomes an inert pass-through so the UI runs without a
 * PostHog project.
 */

import { useEffect, type ReactNode } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import posthog from 'posthog-js';

const KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com';

let initialised = false;
function ensureInit(): void {
  if (initialised || typeof window === 'undefined' || !KEY) return;
  posthog.init(KEY, {
    api_host: HOST,
    person_profiles: 'identified_only',
    capture_pageview: false,
    capture_pageleave: true,
    autocapture: true,
    // Respect Do-Not-Track and disable session recording by default;
    // toggle on per environment if needed.
    disable_session_recording: true,
    loaded: (ph) => {
      if (process.env.NODE_ENV === 'development') ph.debug(false);
    },
  });
  initialised = true;
}

function PageViewTracker() {
  const pathname = usePathname();
  const search = useSearchParams();
  useEffect(() => {
    if (!KEY || !pathname) return;
    const url = search?.toString() ? `${pathname}?${search.toString()}` : pathname;
    posthog.capture('$pageview', { $current_url: url });
  }, [pathname, search]);
  return null;
}

export function PostHogProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    ensureInit();
  }, []);
  return (
    <>
      <PageViewTracker />
      {children}
    </>
  );
}
