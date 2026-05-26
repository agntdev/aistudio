import { NextResponse } from 'next/server';

/**
 * GET /api/health
 *
 * Liveness probe — returns 200 as long as the Node process can serve a
 * request. No external calls, no allocation beyond the JSON body.
 */
export async function GET() {
  return NextResponse.json({
    status: 'ok',
    service: 'aistudio-frontend',
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
  });
}
