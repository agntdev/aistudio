import { Queue, Worker, Job } from 'bullmq';
import IORedis from 'ioredis';

/**
 * T03: Training Pipeline Infrastructure
 *
 * This sets up BullMQ + Redis for reliable, queued training jobs.
 *
 * Why BullMQ?
 * - At-least-once delivery
 * - Job progress tracking
 * - Retries with backoff
 * - Concurrency control (important because training is expensive)
 * - Webhook-friendly (we can update job progress from Replicate webhooks)
 */

const connection = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null, // Required by BullMQ
});

export const trainingQueue = new Queue('training', {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5000,
    },
    removeOnComplete: 100, // keep last 100 completed jobs
    removeOnFail: 500,
  },
});

export interface TrainingJobData {
  projectId: string;
  agentId: string;
  datasetUrl: string; // The uploaded ZIP or folder on S3/DO Spaces
  triggerWord: string; // e.g. "TOK" or the person's name
  modelName?: string;
  resolution?: number;
  steps?: number;
  // Other LoRA hyperparameters
}

export type TrainingJob = Job<TrainingJobData>;

/**
 * Enqueue a new training job.
 * Called from the frontend after successful dataset upload (T02).
 */
export async function enqueueTrainingJob(data: TrainingJobData) {
  const job = await trainingQueue.add('train-lora', data, {
    // Optional: jobId can be used for idempotency
  });
  return job;
}

/**
 * Worker setup (run in a separate process or via `npm run worker`)
 * This is where the actual Replicate/Fal call happens.
 */
export function createTrainingWorker() {
  return new Worker<TrainingJobData>(
    'training',
    async (job) => {
      console.log(`[TrainingWorker] Processing job ${job.id} for project ${job.data.projectId}`);

      // TODO (T03): 
      // 1. Download the dataset from job.data.datasetUrl if needed
      // 2. Upload to Replicate or Fal as training input
      // 3. Start the training run
      // 4. Store the Replicate training ID in DB / job data
      // 5. Update job.progress() as webhooks come in

      // For now, simulate a long training run
      await job.updateProgress(10);
      await new Promise((r) => setTimeout(r, 2000));
      await job.updateProgress(50);

      // In real implementation, return the trained model version info
      return {
        status: 'completed',
        modelVersion: 'replicate-model-version-id',
        replicateTrainingId: 'training-xxx',
      };
    },
    { connection, concurrency: 2 } // Only 2 concurrent trainings to control cost
  );
}

// Example: Start the worker when this file is run directly
if (require.main === module) {
  console.log('Starting training worker...');
  const worker = createTrainingWorker();

  worker.on('completed', (job) => {
    console.log(`Job ${job.id} completed`);
  });

  worker.on('failed', (job, err) => {
    console.error(`Job ${job?.id} failed:`, err);
  });
}
