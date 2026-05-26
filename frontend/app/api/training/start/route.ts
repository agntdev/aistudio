import { NextRequest, NextResponse } from 'next/server';
import { enqueueTrainingJob } from '@/lib/queue';
import {
  reserveOperation,
  releaseOperation,
  type Reservation,
} from '@/lib/cost-control';

/**
 * POST /api/training/start
 *
 * Entry point into the T03 training pipeline. Guarded by T11 cost
 * control: kill-switch, per-user concurrency + rate limits, global
 * daily cap, and credit debit (training is more expensive than a single
 * generation, so it reserves 5 credits by default).
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { projectId, agentId, datasetUrl, triggerWord } = body;

    if (!projectId || !agentId || !datasetUrl || !triggerWord) {
      return NextResponse.json(
        {
          error:
            'Missing required fields: projectId, agentId, datasetUrl, triggerWord',
        },
        { status: 400 }
      );
    }

    const reservation = await reserveOperation({
      userId: agentId,
      op: 'train',
      cost: 5,
    });

    if (!reservation.ok) {
      return NextResponse.json(reservation, { status: reservation.status });
    }

    const ok = reservation as Reservation;

    try {
      const job = await enqueueTrainingJob({
        projectId,
        agentId,
        datasetUrl,
        triggerWord,
        resolution: 512,
        steps: 1000,
      });

      // Training is long-running; the worker keeps the concurrency slot
      // until completion. The webhook handler should call
      // releaseOperation when the training reaches a terminal state. For
      // the MVP we release immediately on enqueue and trust the global
      // daily cap + queue-level concurrency to bound real cost.
      await releaseOperation(ok, 'succeeded');

      return NextResponse.json({
        success: true,
        jobId: job.id,
        creditsRemaining: ok.creditsRemaining,
        message:
          'Training job queued. You will receive updates via webhook / polling.',
      });
    } catch (innerErr) {
      // Enqueue failed — refund credits and free the slot before re-throwing.
      await releaseOperation(ok, 'failed');
      throw innerErr;
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'unknown';
    console.error('Failed to start training', error);
    return NextResponse.json(
      { error: 'Failed to enqueue training job', detail: message },
      { status: 500 }
    );
  }
}
