/**
 * Sentry client-side init (T08).
 *
 * Runs in the browser. Reads its DSN from a `NEXT_PUBLIC_SENTRY_DSN` so
 * Next.js inlines it into the client bundle; falls back to a no-op when
 * unset so local dev / previews don't ship browser errors anywhere.
 */

import * as Sentry from '@sentry/nextjs';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NEXT_PUBLIC_SENTRY_ENV ?? process.env.NODE_ENV ?? 'development',
    release: process.env.NEXT_PUBLIC_SENTRY_RELEASE,

    // Sample 10% of regular traffic for performance traces; 100% of
    // errors are always sent.
    tracesSampleRate: Number(process.env.NEXT_PUBLIC_SENTRY_TRACES_RATE ?? 0.1),

    // Replays only on errors — full session replay is expensive and we
    // don't need it for nominal UX work.
    replaysOnErrorSampleRate: 1.0,
    replaysSessionSampleRate: 0.0,

    integrations: [
      Sentry.replayIntegration({ maskAllText: false, blockAllMedia: true }),
    ],

    // Filter out a handful of known-noisy browser-extension errors so
    // the dashboard stays signal-heavy.
    ignoreErrors: [
      'ResizeObserver loop limit exceeded',
      'ResizeObserver loop completed with undelivered notifications.',
      /chrome-extension:\/\//,
    ],
  });
}
