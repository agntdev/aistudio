/**
 * Next.js instrumentation entrypoint (T08).
 *
 * Loads Sentry config for the active runtime. Next.js calls `register`
 * once per worker on cold start, so this is the right place to wire
 * in monitoring — we conditionally load nodejs vs edge configs.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}
