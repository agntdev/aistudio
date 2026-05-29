/**
 * Structured logger (T08).
 *
 * Wraps pino with a redaction set that covers every secret-bearing field
 * the codebase currently puts on a request (Clerk, Stripe, S3, Replicate,
 * Postgres password). The logger is a singleton — Next.js may re-import
 * this module across server bundles, so the cached instance is keyed on
 * `globalThis` to avoid double-init in dev with HMR.
 *
 * Use `logger()` for free-floating logs and `logger().child({ ... })`
 * inside request handlers to bind a request-scoped context (route name,
 * user id, request id) once.
 */

import pino, { type Logger } from 'pino';

const GLOBAL_KEY = Symbol.for('aistudio.logger');
type LoggerGlobal = typeof globalThis & { [GLOBAL_KEY]?: Logger };

const REDACT_PATHS = [
  // Auth
  'req.headers.authorization',
  'req.headers.cookie',
  'headers.authorization',
  'headers.cookie',
  // Webhook signatures (Clerk/Stripe/Replicate)
  'req.headers["svix-signature"]',
  'req.headers["stripe-signature"]',
  'req.headers["x-replicate-signature"]',
  // Anything that looks like a secret in arbitrary objects we log
  '*.password',
  '*.apiKey',
  '*.api_key',
  '*.secret',
  '*.token',
  'CLERK_SECRET_KEY',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'S3_SECRET_ACCESS_KEY',
  'REPLICATE_API_TOKEN',
  'SENTRY_AUTH_TOKEN',
];

function build(): Logger {
  return pino({
    name: 'aistudio',
    level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
    base: {
      service: 'aistudio-frontend',
      env: process.env.NODE_ENV ?? 'development',
      release: process.env.SENTRY_RELEASE ?? process.env.VERCEL_GIT_COMMIT_SHA ?? undefined,
    },
    redact: { paths: REDACT_PATHS, censor: '[redacted]' },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      // Make Sentry happy: severity is the canonical level field.
      level(label) {
        return { level: label };
      },
    },
  });
}

export function logger(): Logger {
  const g = globalThis as LoggerGlobal;
  if (!g[GLOBAL_KEY]) g[GLOBAL_KEY] = build();
  return g[GLOBAL_KEY];
}
