/**
 * Route-handler wrapper (T08).
 *
 * Wraps a Next.js App Router handler with:
 *
 *   - structured request log (one line per request, latency, status)
 *   - Sentry capture for unhandled errors (re-throws so Next still 500s)
 *   - per-route counter + latency histogram in `lib/metrics`
 *
 * Use it like:
 *
 *     export const POST = withObservability('billing.checkout', async (req) => {
 *       …
 *     });
 *
 * The wrapper is opt-in so we don't accidentally double-instrument
 * Sentry's own instrumentation hooks.
 */

import { NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';

import { logger } from './logger';
import { incCounter, observeMs } from './metrics';

type Handler = (req: Request, ctx?: { params?: Promise<Record<string, string>> }) => Promise<Response>;

export function withObservability(routeName: string, handler: Handler): Handler {
  return async (req, ctx) => {
    const t0 = performance.now();
    const url = new URL(req.url);
    const log = logger().child({ route: routeName, method: req.method, path: url.pathname });

    incCounter('http.requests_total', { route: routeName, method: req.method });
    try {
      const res = await handler(req, ctx);
      const durationMs = performance.now() - t0;
      observeMs('http.request_duration_ms', durationMs, {
        route: routeName,
        method: req.method,
        status: res.status,
      });
      log.info({ status: res.status, durationMs: Math.round(durationMs) }, 'request handled');
      return res;
    } catch (err) {
      const durationMs = performance.now() - t0;
      incCounter('http.errors_total', { route: routeName });
      observeMs('http.request_duration_ms', durationMs, {
        route: routeName,
        method: req.method,
        status: 500,
      });
      log.error({ err, durationMs: Math.round(durationMs) }, 'request failed');
      Sentry.captureException(err, { tags: { route: routeName, method: req.method } });
      // Surface as JSON 500 so the client always gets a parseable body.
      return NextResponse.json(
        { error: 'Internal server error' },
        { status: 500 },
      );
    }
  };
}
