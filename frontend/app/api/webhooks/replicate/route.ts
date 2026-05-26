import { NextRequest, NextResponse } from 'next/server';

/**
 * POST /api/webhooks/replicate
 *
 * Replicate (and similar providers like Fal) will POST training status updates here.
 *
 * This is critical for T03:
 * - Receive "training started", "step 200/1000", "completed", "failed"
 * - Update job progress in BullMQ
 * - Notify the user (email, in-app, etc.)
 * - When completed, store the trained model version so it can be used for generation (T04)
 */
export async function POST(req: NextRequest) {
  try {
    const payload = await req.json();

    console.log('[Replicate Webhook]', JSON.stringify(payload, null, 2));

    const { id: trainingId, status, progress, error, output } = payload;

    // TODO (T03 full implementation):
    // 1. Look up the BullMQ job associated with this `trainingId`
    //    (you would store the mapping when starting the Replicate training)
    // 2. job.updateProgress(progress || (status === 'succeeded' ? 100 : 0))
    // 3. If status === 'succeeded', store the output.model in your DB
    // 4. Trigger notifications

    if (status === 'succeeded') {
      console.log('Training completed! Model:', output);
      // In real code: await updateTrainingJob(trainingId, { status: 'completed', modelVersion: output.version });
    }

    if (status === 'failed') {
      console.error('Training failed:', error);
    }

    // Always acknowledge the webhook quickly
    return NextResponse.json({ received: true });
  } catch (err: any) {
    console.error('Webhook processing error', err);
    // Still return 200 so Replicate doesn't retry excessively
    return NextResponse.json({ error: 'Processing failed but acknowledged' }, { status: 200 });
  }
}
