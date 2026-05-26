import { NextRequest, NextResponse } from 'next/server';
import { handleReplicateWebhook } from '@/lib/queue';

/**
 * POST /api/webhooks/replicate
 *
 * Receives training status updates from Replicate and forwards them to
 * the matching BullMQ job via the replicate-id index.
 */
export async function POST(req: NextRequest) {
  try {
    const payload = await req.json();
    const result = await handleReplicateWebhook(payload);
    return NextResponse.json({ received: true, ...result });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'unknown';
    console.error('[Replicate Webhook] processing error', err);
    // Acknowledge with 200 so Replicate doesn't aggressively retry on
    // transient errors; we'll surface the failure in logs / job retries.
    return NextResponse.json({ received: true, error: message }, { status: 200 });
  }
}
