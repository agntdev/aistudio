import * as Sentry from '@sentry/nextjs';

/**
 * Sentry edge runtime init (T08). Loaded by Next.js for middleware /
 * edge routes. Only activates when SENTRY_DSN is configured.
 */
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'development',
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE || '0.1'),
  });
}
