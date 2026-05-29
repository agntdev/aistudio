/**
 * Sentry server-side init (T08).
 *
 * Runs in Node route handlers, the BullMQ worker (scripts/worker.ts),
 * and Next.js server actions. Reads its DSN from the non-public
 * `SENTRY_DSN` so production secrets stay off the client bundle.
 */

import * as Sentry from '@sentry/nextjs';

const dsn = process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENV ?? process.env.NODE_ENV ?? 'development',
    release: process.env.SENTRY_RELEASE ?? process.env.VERCEL_GIT_COMMIT_SHA,

    // Lower default than the client: server traffic is denser, the
    // signal-to-cost ratio of 100% traces is poor.
    tracesSampleRate: Number(process.env.SENTRY_TRACES_RATE ?? 0.05),

    // Don't ship request bodies (may contain user uploads / prompts /
    // PII). Sentry's default for headers strips `authorization` and
    // `cookie`; we add more in `lib/logger.ts` for our own logger.
    sendDefaultPii: false,

    // The Replicate / Stripe / Clerk SDKs occasionally throw 4xx
    // upstream errors as exceptions we don't need to track separately;
    // we surface those in metrics + structured logs already.
    beforeSend(event, hint) {
      const err = hint.originalException as { status?: number } | undefined;
      if (err && typeof err.status === 'number' && err.status >= 400 && err.status < 500) {
        return null;
      }
      return event;
    },
  });
}
