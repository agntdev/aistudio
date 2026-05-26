import { NextRequest, NextResponse } from 'next/server';
import { enqueueTrainingJob } from '@/lib/queue';

/**
 * POST /api/training/start
 *
 * Called by the frontend after a user has successfully uploaded their
 * dataset (via T02 presigned URLs) and wants to kick off LoRA training.
 *
 * This is the entry point into the T03 training pipeline.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const { projectId, agentId, datasetUrl, triggerWord } = body;

    if (!projectId || !agentId || !datasetUrl || !triggerWord) {
      return NextResponse.json(
        { error: 'Missing required fields: projectId, agentId, datasetUrl, triggerWord' },
        { status: 400 }
      );
    }

    // Enqueue the job into BullMQ
    const job = await enqueueTrainingJob({
      projectId,
      agentId,
      datasetUrl,
      triggerWord,
      // sensible defaults for Flux LoRA training
      resolution: 512,
      steps: 1000,
    });

    return NextResponse.json({
      success: true,
      jobId: job.id,
      message: 'Training job queued. You will receive updates via webhook / polling.',
    });
  } catch (error: any) {
    console.error('Failed to start training', error);
    return NextResponse.json(
      { error: 'Failed to enqueue training job' },
      { status: 500 }
    );
  }
}
