import { Queue, Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import Replicate from 'replicate';

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
  const replicate = new Replicate({
    auth: process.env.REPLICATE_API_TOKEN,
  });

  return new Worker<TrainingJobData>(
    'training',
    async (job) => {
      console.log(`[TrainingWorker] Processing job ${job.id} for project ${job.data.projectId}`);

      const { datasetUrl, triggerWord, resolution = 512, steps = 1000 } = job.data;

      // 1. Start the actual Replicate training
      // Using a popular Flux LoRA trainer (update model version as needed)
      const training = await replicate.trainings.create({
        version: "ostris/flux-dev-lora-trainer:4e0a6b2c1f8e9d7a3b5c6d4e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a", // placeholder - use latest from Replicate
        input: {
          input_images: datasetUrl, // zip URL from DO Spaces
          trigger_word: triggerWord,
          resolution,
          steps,
          // other hyperparameters can come from job.data
        },
        webhook: `${process.env.NEXT_PUBLIC_APP_URL}/api/webhooks/replicate`,
        webhook_events_filter: ["start", "logs", "completed"],
      });

      console.log(`[TrainingWorker] Started Replicate training: ${training.id}`);

      await job.updateProgress(20);

      // Store the training ID on the job for webhook correlation
      await job.updateData({
        ...job.data,
        replicateTrainingId: training.id,
      });

      // The actual completion will be handled by the webhook
      // For now we return the training ID so the caller can track it
      return {
        status: 'started',
        replicateTrainingId: training.id,
        replicateTrainingUrl: `https://replicate.com/p/${training.id}`,
      };
    },
    { connection, concurrency: 2 }
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
