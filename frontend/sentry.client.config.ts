import * as Sentry from '@sentry/nextjs';

/**
 * Sentry browser init (T08).
 *
 * Only initialises when NEXT_PUBLIC_SENTRY_DSN is set.
 */
if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    environment: process.env.NEXT_PUBLIC_ENVIRONMENT || 'development',
    tracesSampleRate: Number(process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE || '0.1'),
    replaysOnErrorSampleRate: 0,
    replaysSessionSampleRate: 0,
  });
}
