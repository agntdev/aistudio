/**
 * Training worker entry point.
 *
 * Run via:  npm run worker   (uses tsx)
 *
 * ESM-friendly replacement for the old `require.main === module` block.
 * Kept out of the Next.js app/ tree so it isn't bundled by the framework.
 */
import { createTrainingWorker } from '../lib/queue';

const worker = createTrainingWorker();

worker.on('completed', (job) => {
  console.log(`[worker] job ${job.id} completed`);
});

worker.on('failed', (job, err) => {
  console.error(`[worker] job ${job?.id} failed:`, err);
});

const shutdown = async () => {
  console.log('[worker] shutting down…');
  await worker.close();
  process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

console.log('[worker] started — listening for training jobs');
