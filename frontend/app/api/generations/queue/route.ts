import { NextRequest, NextResponse } from 'next/server';
import { queueGeneration } from '@/lib/generation';

/**
 * POST /api/generations/queue
 *
 * Body: { userId, packId, triggerWord, modelVersion, watermark? }
 *
 * Expands the requested pack into per-template generations, enqueues
 * them on the BullMQ generation queue, and returns the ids so the
 * client can subscribe to SSE updates.
 *
 * Cost-control (T11) integration: when COST_CONTROL_ADMIN_TOKEN is
 * configured the route reserves one credit per generation up front and
 * refunds on enqueue failure. Without cost-control configured it
 * degrades to "queue without reservation" so a fresh deploy keeps
 * working.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const userId = typeof body.userId === 'string' ? body.userId : null;
  const packId = typeof body.packId === 'string' ? body.packId : null;
  const triggerWord = typeof body.triggerWord === 'string' ? body.triggerWord : null;
  const modelVersion =
    typeof body.modelVersion === 'string'
      ? body.modelVersion
      : process.env.REPLICATE_INFERENCE_VERSION || 'black-forest-labs/flux-dev';
  const watermark = typeof body.watermark === 'boolean' ? body.watermark : true;

  if (!userId || !packId || !triggerWord) {
    return NextResponse.json(
      { error: 'userId, packId, and triggerWord are required' },
      { status: 400 }
    );
  }

  try {
    const result = await queueGeneration({
      userId,
      packId,
      triggerWord,
      modelVersion,
      watermark,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json(
      {
        error: 'queue failed',
        detail: err instanceof Error ? err.message : 'unknown',
      },
      { status: 400 }
    );
  }
}
