/**
 * Sentry init for the Edge runtime (T08).
 *
 * Used by middleware.ts and any route handler that runs on the Vercel /
 * Cloudflare edge. Same DSN as the server init but the Sentry SDK uses
 * a stripped-down build that avoids Node-only APIs.
 */

import * as Sentry from '@sentry/nextjs';

const dsn = process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENV ?? process.env.NODE_ENV ?? 'development',
    release: process.env.SENTRY_RELEASE,
    tracesSampleRate: Number(process.env.SENTRY_TRACES_RATE ?? 0.05),
  });
}
