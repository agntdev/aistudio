import { NextRequest, NextResponse } from 'next/server';
import { enqueueTrainingJob } from '@/lib/queue';
import {
  reserveOperation,
  releaseOperation,
  type Reservation,
} from '@/lib/cost-control';
import { logger } from '@/lib/logger';
import { analytics } from '@/lib/analytics';
import { counters, timers } from '@/lib/metrics';

/**
 * POST /api/training/start
 *
 * Entry point into the T03 training pipeline. Guarded by T11 cost
 * control: kill-switch, per-user concurrency + rate limits, global
 * daily cap, and credit debit (training is more expensive than a single
 * generation, so it reserves 5 credits by default).
 */
export async function POST(req: NextRequest) {
  const stopTimer = timers.start('training.start.duration_ms');
  try {
    const body = await req.json();
    const { projectId, agentId, datasetUrl, triggerWord } = body;

    if (!projectId || !agentId || !datasetUrl || !triggerWord) {
      counters.inc('training.start.error', { reason: 'bad-request' });
      return NextResponse.json(
        {
          error:
            'Missing required fields: projectId, agentId, datasetUrl, triggerWord',
        },
        { status: 400 }
      );
    }

    const log = logger.with({ projectId, agentId });

    const reservation = await reserveOperation({
      userId: agentId,
      op: 'train',
      cost: 5,
    });

    if (!reservation.ok) {
      log.warn('training.start.denied', { code: reservation.code });
      counters.inc('training.start.denied', { code: reservation.code });
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

      await releaseOperation(ok, 'succeeded');

      log.info('training.start.queued', { jobId: job.id });
      counters.inc('training.start.queued');
      analytics.capture({
        distinctId: agentId,
        event: 'training_started',
        properties: { projectId, jobId: job.id },
      });
      stopTimer({ outcome: 'queued' });

      return NextResponse.json({
        success: true,
        jobId: job.id,
        creditsRemaining: ok.creditsRemaining,
        message:
          'Training job queued. You will receive updates via webhook / polling.',
      });
    } catch (innerErr) {
      await releaseOperation(ok, 'failed');
      throw innerErr;
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'unknown';
    logger.error('training.start.failed', error, { reqId: req.headers.get('x-request-id') });
    counters.inc('training.start.error', { reason: 'exception' });
    stopTimer({ outcome: 'error' });
    return NextResponse.json(
      { error: 'Failed to enqueue training job', detail: message },
      { status: 500 }
    );
  }
}
