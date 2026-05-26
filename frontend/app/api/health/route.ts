import { NextResponse } from 'next/server';

/**
 * GET /api/health
 *
 * Lightweight liveness probe used by Docker HEALTHCHECK and the Vercel
 * cron (T09). Returns 200 as long as the Node process can serve a
 * request — no external calls.
 */
export async function GET() {
  return NextResponse.json({
    status: 'ok',
    service: 'aistudio-frontend',
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
  });
}
