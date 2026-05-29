/**
 * Training worker entry point.
 *
 * Run via:  npm run worker   (uses tsx)
 *
 * Loads the server-side Sentry config + structured logger from T08 so
 * the worker emits to the same observability stack as the web tier.
 */
import '../sentry.server.config';
import * as Sentry from '@sentry/nextjs';

import { createTrainingWorker } from '../lib/queue';
import { logger } from '../lib/logger';
import { incCounter, observeMs } from '../lib/metrics';
import { Events, shutdownAnalytics, trackServer } from '../lib/analytics';

const log = logger().child({ component: 'worker' });

const worker = createTrainingWorker();

worker.on('active', (job) => {
  log.info({ jobId: job.id, name: job.name }, 'job active');
  incCounter('worker.jobs_started_total', { name: job.name });
});

worker.on('completed', (job) => {
  const startedAt = job.processedOn ?? job.timestamp;
  const durationMs = startedAt ? Date.now() - startedAt : 0;
  log.info({ jobId: job.id, name: job.name, durationMs }, 'job completed');
  observeMs('worker.job_duration_ms', durationMs, { name: job.name, outcome: 'ok' });
  incCounter('worker.jobs_completed_total', { name: job.name });
  const data = job.data as { userId?: string };
  if (data?.userId) {
    trackServer({
      distinctId: data.userId,
      event: Events.TrainingCompleted,
      properties: { jobId: job.id, durationMs },
    });
  }
});

worker.on('failed', (job, err) => {
  log.error({ jobId: job?.id, err }, 'job failed');
  incCounter('worker.jobs_failed_total', { name: job?.name ?? 'unknown' });
  Sentry.captureException(err, { tags: { component: 'worker', jobName: job?.name } });
  const data = job?.data as { userId?: string } | undefined;
  if (data?.userId) {
    trackServer({
      distinctId: data.userId,
      event: Events.TrainingFailed,
      properties: { jobId: job?.id, error: err instanceof Error ? err.message : String(err) },
    });
  }
});

const shutdown = async () => {
  log.info('worker shutting down');
  await worker.close();
  await shutdownAnalytics();
  await Sentry.close(2_000);
  process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

log.info('worker started — listening for training jobs');
