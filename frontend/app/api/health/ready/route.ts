import { NextResponse } from 'next/server';
import IORedis from 'ioredis';
import { logger } from '@/lib/logger';

/**
 * GET /api/health/ready
 *
 * Readiness probe — confirms downstream dependencies are reachable.
 * Currently checks Redis (used by BullMQ + cost control). Returns 503
 * with a per-dependency status so a load balancer can see which one
 * failed.
 */

async function pingRedis(): Promise<{ ok: boolean; detail?: string; latencyMs?: number }> {
  const url = process.env.REDIS_URL || 'redis://localhost:6379';
  const client = new IORedis(url, {
    maxRetriesPerRequest: 1,
    connectTimeout: 1500,
    lazyConnect: false,
  });
  const startedAt = Date.now();
  try {
    const reply = await client.ping();
    if (reply !== 'PONG') return { ok: false, detail: `unexpected reply: ${reply}` };
    return { ok: true, latencyMs: Date.now() - startedAt };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  } finally {
    client.disconnect();
  }
}

export async function GET() {
  const redis = await pingRedis();

  const allOk = redis.ok;
  if (!allOk) {
    logger.warn('health.ready.degraded', { redis });
  }

  return NextResponse.json(
    {
      status: allOk ? 'ready' : 'degraded',
      checks: { redis },
      timestamp: new Date().toISOString(),
    },
    { status: allOk ? 200 : 503 }
  );
}
