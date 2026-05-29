import { NextResponse } from 'next/server';

import { renderProm, snapshot } from '@/lib/metrics';

/**
 * GET /api/metrics
 *
 * Exposes the in-process counters + histograms from `lib/metrics` for
 * Prometheus / Grafana Cloud scraping. Defaults to the Prom text
 * exposition format; pass `?format=json` for the raw snapshot.
 *
 * Protected by a shared-secret header (`x-metrics-token`) when
 * `METRICS_TOKEN` is set — the scraper must send it. Public endpoints
 * are fine for `/api/health` but metrics can leak SLO data and queue
 * depth.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const token = process.env.METRICS_TOKEN;
  if (token) {
    const sent = req.headers.get('x-metrics-token');
    if (sent !== token) {
      return new NextResponse('Unauthorized', { status: 401 });
    }
  }

  const url = new URL(req.url);
  if (url.searchParams.get('format') === 'json') {
    return NextResponse.json(snapshot(), {
      headers: { 'Cache-Control': 'no-store' },
    });
  }

  return new NextResponse(renderProm(), {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}
