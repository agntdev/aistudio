/**
 * Next.js instrumentation hook (T08).
 *
 * Called once per server runtime on cold-start. We register the right
 * Sentry config for the runtime and emit a single startup log.
 *
 * @see https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */

import * as Sentry from '@sentry/nextjs';

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  } else if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }

  // Logger is a separate import so we don't pull pino into the edge
  // runtime where it isn't needed.
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { logger } = await import('./lib/logger');
    logger().info(
      {
        runtime: process.env.NEXT_RUNTIME,
        release: process.env.SENTRY_RELEASE ?? process.env.VERCEL_GIT_COMMIT_SHA ?? null,
      },
      'aistudio-frontend started',
    );
  }
}

export const onRequestError = Sentry.captureRequestError;
