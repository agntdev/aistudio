import * as Sentry from '@sentry/nextjs';

/**
 * Sentry server-side init (T08).
 *
 * Only initialises when SENTRY_DSN is set so local dev doesn't need a
 * Sentry account and the build doesn't try to upload source maps to a
 * non-existent project.
 */
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'development',
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE || '0.1'),
    enabled: process.env.NODE_ENV !== 'test',
  });
}
