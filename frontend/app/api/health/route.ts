import { NextResponse } from 'next/server';
import IORedis from 'ioredis';

import { getDb } from '@/lib/db';
import { logger } from '@/lib/logger';
import { snapshot } from '@/lib/metrics';

/**
 * GET /api/health
 *
 * Two-tier liveness + readiness probe used by Docker HEALTHCHECK, the
 * Fly.io health check, the Vercel cron (T09), and the on-call dashboard.
 *
 *   - `?mode=live`     — cheap liveness: returns 200 as long as the
 *                        process can serve a request (no I/O).
 *   - default / `?mode=ready` — checks each downstream dependency
 *                                (Postgres, Redis) with a short timeout
 *                                and returns 503 on any failure.
 *
 * The body includes a snapshot of in-process metrics so the dashboard
 * doesn't need to scrape `/api/metrics` separately for a quick view.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TIMEOUT_MS = 1_500;

async function withTimeout<T>(p: Promise<T>, ms = TIMEOUT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

interface CheckResult {
  ok: boolean;
  latencyMs?: number;
  error?: string;
}

async function checkPostgres(): Promise<CheckResult> {
  const t0 = performance.now();
  try {
    const r = await withTimeout(getDb().query('SELECT 1'));
    return { ok: r.rowCount === 1, latencyMs: Math.round(performance.now() - t0) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

let _redis: IORedis | null = null;
function getRedis(): IORedis | null {
  if (_redis) return _redis;
  const url = process.env.REDIS_URL;
  if (!url) return null;
  _redis = new IORedis(url, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    connectTimeout: TIMEOUT_MS,
  });
  return _redis;
}

async function checkRedis(): Promise<CheckResult | { ok: true; skipped: true }> {
  const r = getRedis();
  if (!r) return { ok: true, skipped: true };
  const t0 = performance.now();
  try {
    const pong = await withTimeout(r.ping());
    return { ok: pong === 'PONG', latencyMs: Math.round(performance.now() - t0) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const mode = url.searchParams.get('mode') ?? 'ready';

  if (mode === 'live') {
    return NextResponse.json({
      status: 'ok',
      service: 'aistudio-frontend',
      mode: 'live',
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
    });
  }

  const [postgres, redis] = await Promise.all([checkPostgres(), checkRedis()]);
  const ok = postgres.ok && redis.ok;
  const body = {
    status: ok ? 'ok' : 'degraded',
    service: 'aistudio-frontend',
    mode: 'ready',
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
    release:
      process.env.SENTRY_RELEASE ?? process.env.VERCEL_GIT_COMMIT_SHA ?? 'dev',
    checks: { postgres, redis },
    metricsSummary: summariseMetrics(),
  };

  if (!ok) {
    logger().warn({ checks: body.checks }, 'health check degraded');
  }
  return NextResponse.json(body, { status: ok ? 200 : 503 });
}

function summariseMetrics() {
  const s = snapshot();
  const reqs = s.counters['http.requests_total'] ?? 0;
  const errs = s.counters['http.errors_total'] ?? 0;
  const lat = s.histograms['http.request_duration_ms'];
  return {
    requests: reqs,
    errors: errs,
    errorRate: reqs > 0 ? errs / reqs : 0,
    avgLatencyMs: lat && lat.count > 0 ? Math.round(lat.sum / lat.count) : null,
    p95LatencyMs: estimateP95(lat),
  };
}

function estimateP95(h?: ReturnType<typeof snapshot>['histograms'][string]): number | null {
  if (!h || h.count === 0) return null;
  const target = h.count * 0.95;
  let cumulative = 0;
  const sorted = Object.entries(h.buckets)
    .map(([k, v]) => ({ le: k === '<=Infinity' ? Infinity : Number(k.replace('<=', '')), count: v }))
    .sort((a, b) => a.le - b.le);
  for (const b of sorted) {
    cumulative = b.count;
    if (cumulative >= target) return b.le === Infinity ? Math.round(h.max) : b.le;
  }
  return Math.round(h.max);
}
