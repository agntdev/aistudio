/**
 * Generation pipeline (T04).
 *
 * Bridges prompt packs (lib/prompt-packs) with the Flux inference call
 * on Replicate and the post-processing pipeline (thumbnail / watermark
 * via lib/image-processing) and the output safety check from T06.
 *
 *   queueGeneration({ userId, packId, triggerWord, modelVersion, ... })
 *     -> returns { generationIds: string[] } immediately; each row is
 *     marked 'queued' and the worker picks them up.
 *
 *   runGeneration(generationId) — called by the worker. Calls Replicate,
 *   waits for the output URL, runs the output through processGeneratedImage,
 *   re-checks NSFW via checkGeneratedImageSafety, and either marks the
 *   generation as `succeeded` with image_url, or `failed`/`blocked` with
 *   an explanation.
 *
 * Persistence here is an in-memory map so the gallery fixture can be
 * swapped for real records without changing call sites. T09 ships the
 * Postgres schema; wiring this to pg is a follow-up.
 */

import { Queue, Worker, type Job } from 'bullmq';
import IORedis from 'ioredis';
import Replicate from 'replicate';
import { expandPack, getPromptPack } from './prompt-packs';

export type GenerationStatus = 'queued' | 'processing' | 'succeeded' | 'failed' | 'blocked';

export interface GenerationRecord {
  id: string;
  userId: string;
  packId: string;
  templateName: string;
  prompt: string;
  negativePrompt: string;
  triggerWord: string;
  modelVersion: string;
  status: GenerationStatus;
  progress: number;
  imageUrl?: string;
  thumbnailUrl?: string;
  width: number;
  height: number;
  watermark: boolean;
  errorReason?: string;
  createdAt: string;
}

interface GenerationJobData {
  generationId: string;
}

const connection = new IORedis(
  process.env.REDIS_URL || 'redis://localhost:6379',
  { maxRetriesPerRequest: null }
);

export const generationQueue = new Queue<GenerationJobData>('generation', {
  connection,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: 200,
    removeOnFail: 500,
  },
});

const records = new Map<string, GenerationRecord>();

export function getGeneration(id: string): GenerationRecord | undefined {
  return records.get(id);
}

export function listGenerationsForUser(userId: string, limit = 60): GenerationRecord[] {
  return [...records.values()]
    .filter((g) => g.userId === userId)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, limit);
}

export interface QueueInput {
  userId: string;
  packId: string;
  triggerWord: string;
  modelVersion: string;
  watermark?: boolean;
}

/**
 * Expand the pack and enqueue one job per template. Returns the
 * generation ids so the caller can wire up SSE for live progress.
 */
export async function queueGeneration(input: QueueInput): Promise<{ generationIds: string[] }> {
  const pack = getPromptPack(input.packId);
  if (!pack) throw new Error(`unknown pack ${input.packId}`);
  const expanded = expandPack(input.packId, input.triggerWord);
  const ids: string[] = [];

  for (const exp of expanded) {
    const id = `gen_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const record: GenerationRecord = {
      id,
      userId: input.userId,
      packId: input.packId,
      templateName: exp.templateName,
      prompt: exp.prompt,
      negativePrompt: exp.negativePrompt,
      triggerWord: input.triggerWord,
      modelVersion: input.modelVersion,
      status: 'queued',
      progress: 0,
      width: exp.defaults.width,
      height: exp.defaults.height,
      watermark: input.watermark ?? true,
      createdAt: new Date().toISOString(),
    };
    records.set(id, record);
    await generationQueue.add('generate', { generationId: id });
    ids.push(id);
  }

  return { generationIds: ids };
}

function updateRecord(id: string, patch: Partial<GenerationRecord>) {
  const existing = records.get(id);
  if (!existing) return;
  records.set(id, { ...existing, ...patch });
}

/**
 * Run a single generation end-to-end. Designed to be called from the
 * worker but exposed so unit tests / admin tools can drive it directly.
 *
 * Output safety check + image processing are kept inline so a model
 * that returns unsafe pixels is caught before the URL leaks into the
 * user's gallery.
 */
export async function runGeneration(
  generationId: string,
  deps: {
    fetchOutput: (url: string) => Promise<Buffer>;
    checkOutputSafety: (buf: Buffer) => Promise<{ isNSFW: boolean; reasons: string[] }>;
    process: (buf: Buffer, opts: { watermark: boolean }) => Promise<{ master: Buffer; thumbnail: Buffer; width: number; height: number }>;
    upload: (id: string, masterBuf: Buffer, thumbBuf: Buffer) => Promise<{ imageUrl: string; thumbnailUrl: string }>;
    callModel: (record: GenerationRecord) => Promise<{ outputUrl: string }>;
  }
): Promise<GenerationRecord> {
  const record = records.get(generationId);
  if (!record) throw new Error(`unknown generation ${generationId}`);

  updateRecord(generationId, { status: 'processing', progress: 10 });

  try {
    const { outputUrl } = await deps.callModel(record);
    updateRecord(generationId, { progress: 70 });

    const raw = await deps.fetchOutput(outputUrl);
    const safety = await deps.checkOutputSafety(raw);
    if (safety.isNSFW) {
      updateRecord(generationId, {
        status: 'blocked',
        progress: 100,
        errorReason: `output blocked: ${safety.reasons.join(', ') || 'NSFW'}`,
      });
      return records.get(generationId)!;
    }

    const processed = await deps.process(raw, { watermark: record.watermark });
    const { imageUrl, thumbnailUrl } = await deps.upload(
      generationId,
      processed.master,
      processed.thumbnail
    );

    updateRecord(generationId, {
      status: 'succeeded',
      progress: 100,
      imageUrl,
      thumbnailUrl,
      width: processed.width,
      height: processed.height,
    });
  } catch (err) {
    updateRecord(generationId, {
      status: 'failed',
      progress: 100,
      errorReason: err instanceof Error ? err.message : String(err),
    });
  }

  return records.get(generationId)!;
}

/**
 * Default worker factory — invokes Replicate, post-processes via sharp,
 * runs the T06 output safety check. The worker script imports this.
 */
export function createGenerationWorker() {
  const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });

  return new Worker<GenerationJobData>(
    'generation',
    async (job: Job<GenerationJobData>) => {
      const { processGeneratedImage } = await import('./image-processing');
      const { checkGeneratedImageSafetyFromBuffer } = await import('./output-safety');

      const record = await runGeneration(job.data.generationId, {
        callModel: async (rec) => {
          const output = (await replicate.run(
            (rec.modelVersion || process.env.REPLICATE_INFERENCE_VERSION || 'black-forest-labs/flux-dev') as `${string}/${string}`,
            {
              input: {
                prompt: rec.prompt,
                negative_prompt: rec.negativePrompt,
                width: rec.width,
                height: rec.height,
                num_outputs: 1,
              },
            }
          )) as unknown;
          const url = Array.isArray(output)
            ? (output[0] as string)
            : typeof output === 'string'
            ? output
            : '';
          if (!url) throw new Error('replicate returned no output url');
          return { outputUrl: url };
        },
        fetchOutput: async (url) => {
          const res = await fetch(url);
          if (!res.ok) throw new Error(`fetch output ${res.status}`);
          return Buffer.from(await res.arrayBuffer());
        },
        checkOutputSafety: checkGeneratedImageSafetyFromBuffer,
        process: (buf, opts) => processGeneratedImage(buf, opts),
        upload: async (id, master, thumb) => {
          // T02 covers presigned uploads for training datasets. For
          // generations we hand the buffer off to a hosting helper that
          // either writes to S3 (when configured) or returns a data URL
          // for the gallery (dev fallback). Keep the interface here so
          // a real S3 write is a one-file swap.
          const { uploadGenerationAssets } = await import('./generation-upload');
          return uploadGenerationAssets(id, master, thumb);
        },
      });

      return { generationId: job.data.generationId, status: record.status };
    },
    { connection, concurrency: Number(process.env.GENERATION_WORKER_CONCURRENCY || '3') }
  );
}
