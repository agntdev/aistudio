import { NextRequest, NextResponse } from 'next/server';
import { renderPrometheus } from '@/lib/metrics';

/**
 * GET /api/metrics
 *
 * Prometheus exposition endpoint. Guarded by METRICS_TOKEN to keep
 * counters off the public internet; fails closed if unset.
 */
export async function GET(req: NextRequest) {
  const expected = process.env.METRICS_TOKEN;
  if (!expected) {
    return NextResponse.json(
      { error: 'METRICS_TOKEN must be set' },
      { status: 503 }
    );
  }
  const supplied = req.headers.get('x-metrics-token') || req.nextUrl.searchParams.get('token');
  if (supplied !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  return new Response(renderPrometheus(), {
    status: 200,
    headers: { 'Content-Type': 'text/plain; version=0.0.4' },
  });
}
