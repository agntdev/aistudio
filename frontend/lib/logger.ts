/**
 * Structured logger for AIStudio (T08).
 *
 * - Emits JSON lines so downstream log shippers (Vector, Loki, Datadog)
 *   can parse without regex.
 * - Per-call context fields (`requestId`, `userId`, ...) are merged in.
 * - In production, every `error` and `warn` is forwarded to Sentry via
 *   `@sentry/nextjs` so we get exception tracking without scattering
 *   `Sentry.captureException` calls through the codebase.
 *
 * Use:
 *   logger.info('training.start', { userId, jobId });
 *   logger.error('replicate.failed', err, { trainingId });
 */

import * as Sentry from '@sentry/nextjs';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function envLevel(): LogLevel {
  const v = (process.env.LOG_LEVEL || '').toLowerCase();
  if (v === 'debug' || v === 'info' || v === 'warn' || v === 'error') return v;
  return process.env.NODE_ENV === 'production' ? 'info' : 'debug';
}

const CURRENT_LEVEL = envLevel();

type Context = Record<string, unknown>;

function serializeError(err: unknown): Context {
  if (err instanceof Error) {
    return {
      error: {
        name: err.name,
        message: err.message,
        stack: err.stack,
      },
    };
  }
  return { error: err };
}

function emit(level: LogLevel, event: string, ctx: Context) {
  if (LEVEL_RANK[level] < LEVEL_RANK[CURRENT_LEVEL]) return;
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    event,
    ...ctx,
  });
  // eslint-disable-next-line no-console
  (level === 'error' ? console.error : console.log)(line);
}

export interface Logger {
  with(ctx: Context): Logger;
  debug(event: string, ctx?: Context): void;
  info(event: string, ctx?: Context): void;
  warn(event: string, ctx?: Context): void;
  error(event: string, err?: unknown, ctx?: Context): void;
}

function makeLogger(baseCtx: Context): Logger {
  return {
    with(ctx) {
      return makeLogger({ ...baseCtx, ...ctx });
    },
    debug(event, ctx = {}) {
      emit('debug', event, { ...baseCtx, ...ctx });
    },
    info(event, ctx = {}) {
      emit('info', event, { ...baseCtx, ...ctx });
    },
    warn(event, ctx = {}) {
      const merged = { ...baseCtx, ...ctx };
      emit('warn', event, merged);
      try {
        Sentry.captureMessage(event, { level: 'warning', extra: merged });
      } catch {
        /* Sentry not configured — that's fine */
      }
    },
    error(event, err, ctx = {}) {
      const merged = { ...baseCtx, ...ctx, ...(err ? serializeError(err) : {}) };
      emit('error', event, merged);
      try {
        if (err instanceof Error) {
          Sentry.captureException(err, { extra: { event, ...baseCtx, ...ctx } });
        } else {
          Sentry.captureMessage(event, { level: 'error', extra: merged });
        }
      } catch {
        /* Sentry not configured — that's fine */
      }
    },
  };
}

export const logger = makeLogger({ service: 'aistudio-frontend' });
