/**
 * Server-side product analytics (T08).
 *
 * Thin wrapper around `posthog-node`. Single client per process; no-ops
 * silently when `POSTHOG_KEY` (server) is not configured so dev /
 * preview environments don't have to set up PostHog to run.
 *
 * Use `trackServer({ distinctId, event, properties })` for funnel +
 * conversion events (signup, training_started, training_completed,
 * generation_created, generation_failed, billing_checkout_started, …).
 * Client-side page views + autocapture are handled by
 * `components/PostHogProvider.tsx`.
 */

import 'server-only';

import { PostHog } from 'posthog-node';

import { logger } from './logger';

const GLOBAL_KEY = Symbol.for('aistudio.posthog-node');
type AnalyticsGlobal = typeof globalThis & { [GLOBAL_KEY]?: PostHog | null };

function client(): PostHog | null {
  const g = globalThis as AnalyticsGlobal;
  if (g[GLOBAL_KEY] !== undefined) return g[GLOBAL_KEY];
  const key = process.env.POSTHOG_KEY;
  if (!key) {
    g[GLOBAL_KEY] = null;
    return null;
  }
  g[GLOBAL_KEY] = new PostHog(key, {
    host: process.env.POSTHOG_HOST ?? 'https://us.i.posthog.com',
    // Server-side: flush quickly so events aren't lost when the
    // Lambda/Vercel function exits.
    flushAt: 1,
    flushInterval: 0,
  });
  return g[GLOBAL_KEY];
}

export interface TrackParams {
  distinctId: string;
  event: string;
  properties?: Record<string, unknown>;
  groups?: Record<string, string>;
}

export function trackServer({ distinctId, event, properties, groups }: TrackParams): void {
  const ph = client();
  if (!ph) return;
  try {
    ph.capture({ distinctId, event, properties, groups });
  } catch (err) {
    // Never let analytics break a request handler.
    logger().warn({ err, event }, 'posthog: capture failed');
  }
}

/** Identify a known user (call after login / signup). */
export function identifyServer(distinctId: string, properties?: Record<string, unknown>): void {
  const ph = client();
  if (!ph) return;
  try {
    ph.identify({ distinctId, properties });
  } catch (err) {
    logger().warn({ err }, 'posthog: identify failed');
  }
}

/**
 * Flush pending events. Call from long-running scripts (worker.ts) on
 * SIGTERM; serverless handlers don't need this — `flushAt: 1` ships
 * each event immediately.
 */
export async function shutdownAnalytics(): Promise<void> {
  const ph = client();
  if (!ph) return;
  try {
    await ph.shutdown();
  } catch {
    /* swallow */
  }
}

/**
 * Well-known event names. Keeps strings consistent across call sites
 * so PostHog funnels don't fragment due to typos.
 */
export const Events = {
  SignupCompleted: 'signup_completed',
  TrainingStarted: 'training_started',
  TrainingCompleted: 'training_completed',
  TrainingFailed: 'training_failed',
  GenerationCreated: 'generation_created',
  GenerationCompleted: 'generation_completed',
  GenerationFailed: 'generation_failed',
  BillingCheckoutStarted: 'billing_checkout_started',
  BillingCheckoutCompleted: 'billing_checkout_completed',
  SafetyBlocked: 'safety_blocked',
} as const;
export type EventName = (typeof Events)[keyof typeof Events];
