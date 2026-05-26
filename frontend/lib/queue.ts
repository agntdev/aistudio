import { Queue, Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import Replicate from 'replicate';

/**
 * T03: Training Pipeline Infrastructure
 *
 * BullMQ + Redis-backed training queue with:
 * - At-least-once delivery + exponential backoff retries
 * - Webhook-driven progress updates from Replicate
 * - Concurrency control (training is expensive)
 */

const connection = new IORedis(
  process.env.REDIS_URL || 'redis://localhost:6379',
  { maxRetriesPerRequest: null }
);

export const trainingQueue = new Queue('training', {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: 100,
    removeOnFail: 500,
  },
});

export interface TrainingJobData {
  projectId: string;
  agentId: string;
  datasetUrl: string;
  triggerWord: string;
  modelName?: string;
  resolution?: number;
  steps?: number;
  replicateTrainingId?: string;
  modelVersion?: string;
  lastError?: string;
}

export type TrainingJob = Job<TrainingJobData>;

export async function enqueueTrainingJob(data: TrainingJobData) {
  return trainingQueue.add('train-lora', data);
}

/**
 * Persisted mapping from Replicate training id -> BullMQ job id.
 * Stored in Redis so webhook handlers (different process) can resolve the job.
 */
const TRAINING_INDEX_KEY = 'training:replicate-id-index';

export async function indexTrainingId(replicateTrainingId: string, jobId: string) {
  await connection.hset(TRAINING_INDEX_KEY, replicateTrainingId, jobId);
}

export async function lookupJobByTrainingId(
  replicateTrainingId: string
): Promise<TrainingJob | undefined> {
  const jobId = await connection.hget(TRAINING_INDEX_KEY, replicateTrainingId);
  if (!jobId) return undefined;
  return (await trainingQueue.getJob(jobId)) as TrainingJob | undefined;
}

export function createTrainingWorker() {
  const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });

  return new Worker<TrainingJobData>(
    'training',
    async (job) => {
      const { datasetUrl, triggerWord, resolution = 512, steps = 1000 } = job.data;

      const training = await replicate.trainings.create(
        // owner/model (the LoRA trainer's full slug) is required; version is
        // resolved at call-time by Replicate when omitted from this object.
        'ostris',
        'flux-dev-lora-trainer',
        process.env.REPLICATE_TRAINER_VERSION ||
          '4e0a6b2c1f8e9d7a3b5c6d4e7f8a9b0c1d2e3f4a',
        {
          destination: (process.env.REPLICATE_DESTINATION ||
            'aistudio/user-lora') as `${string}/${string}`,
          input: {
            input_images: datasetUrl,
            trigger_word: triggerWord,
            resolution,
            steps,
          },
          webhook: `${process.env.NEXT_PUBLIC_APP_URL}/api/webhooks/replicate`,
          webhook_events_filter: ['start', 'logs', 'completed'],
        }
      );

      await job.updateData({ ...job.data, replicateTrainingId: training.id });
      await indexTrainingId(training.id, String(job.id));
      await job.updateProgress(20);

      return {
        status: 'started',
        replicateTrainingId: training.id,
        replicateTrainingUrl: `https://replicate.com/p/${training.id}`,
      };
    },
    { connection, concurrency: 2 }
  );
}

/**
 * Apply a Replicate webhook payload to the matching BullMQ job.
 * Resolves the job via the replicate-id index so the webhook handler
 * (different process / serverless) can update progress without holding
 * a worker reference.
 */
export async function handleReplicateWebhook(payload: {
  id?: string;
  status?: string;
  progress?: number;
  error?: string;
  output?: { version?: string; weights?: string } | null;
  logs?: string;
}) {
  const trainingId = payload.id;
  if (!trainingId) return { matched: false, reason: 'no-id' };

  const job = await lookupJobByTrainingId(trainingId);
  if (!job) return { matched: false, reason: 'no-job-for-training-id' };

  if (typeof payload.progress === 'number') {
    await job.updateProgress(Math.max(20, Math.min(99, payload.progress)));
  }

  if (payload.status === 'succeeded') {
    await job.updateProgress(100);
    await job.updateData({
      ...job.data,
      modelVersion: payload.output?.version ?? payload.output?.weights ?? 'unknown',
    });
  }

  if (payload.status === 'failed' || payload.status === 'canceled') {
    await job.updateData({
      ...job.data,
      lastError: payload.error || payload.status,
    });
  }

  return { matched: true, jobId: job.id, status: payload.status };
}
