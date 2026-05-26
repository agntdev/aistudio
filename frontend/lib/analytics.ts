/**
 * Server-side product analytics for AIStudio (T08).
 *
 * Wraps `posthog-node` so route handlers can call `analytics.capture(...)`
 * without worrying about lazy initialisation or shutdown on cold start.
 *
 * When POSTHOG_API_KEY is unset the wrapper becomes a no-op so local dev
 * and the build pipeline don't need a real key.
 */

import { PostHog } from 'posthog-node';
import { logger } from './logger';

let _client: PostHog | null = null;
let _initFailed = false;

function getClient(): PostHog | null {
  if (_initFailed) return null;
  if (_client) return _client;
  const key = process.env.POSTHOG_API_KEY;
  if (!key) {
    _initFailed = true;
    return null;
  }
  try {
    _client = new PostHog(key, {
      host: process.env.POSTHOG_HOST || 'https://app.posthog.com',
      // Flush often enough to survive serverless cold-shutdowns.
      flushAt: 5,
      flushInterval: 2000,
    });
    return _client;
  } catch (err) {
    logger.warn('analytics.init.failed', { detail: String(err) });
    _initFailed = true;
    return null;
  }
}

export interface CaptureInput {
  distinctId: string;
  event: string;
  properties?: Record<string, unknown>;
}

export const analytics = {
  capture(input: CaptureInput) {
    const client = getClient();
    if (!client) return;
    try {
      client.capture({
        distinctId: input.distinctId,
        event: input.event,
        properties: input.properties,
      });
    } catch (err) {
      logger.warn('analytics.capture.failed', { detail: String(err), event: input.event });
    }
  },

  identify(distinctId: string, properties: Record<string, unknown>) {
    const client = getClient();
    if (!client) return;
    try {
      client.identify({ distinctId, properties });
    } catch (err) {
      logger.warn('analytics.identify.failed', { detail: String(err) });
    }
  },

  async shutdown() {
    if (!_client) return;
    try {
      await _client.shutdown();
    } catch (err) {
      logger.warn('analytics.shutdown.failed', { detail: String(err) });
    }
  },
};
