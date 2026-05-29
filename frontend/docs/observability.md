# Observability and analytics (T08)

This document covers everything wired up by T08: structured logging,
Sentry error tracking + tracing, PostHog product analytics, health
checks, and performance metrics.

## What's in the box

| Concern | Where | Used by |
|---|---|---|
| Structured logging | `lib/logger.ts` | every route handler + `scripts/worker.ts` |
| Sentry server SDK | `sentry.server.config.ts` + `instrumentation.ts` | every API route + the worker |
| Sentry client SDK | `sentry.client.config.ts` | browser bundle |
| Sentry edge SDK | `sentry.edge.config.ts` | `middleware.ts` |
| Build-time Sentry wiring | `next.config.ts` (`withSentryConfig`) | `next build` source-map upload |
| PostHog server SDK | `lib/analytics.ts` | API routes + `scripts/worker.ts` |
| PostHog browser SDK | `components/PostHogProvider.tsx` | `app/layout.tsx` |
| In-process metrics | `lib/metrics.ts` | `/api/health` + `/api/metrics` |
| Route-handler wrapper | `lib/withObservability.ts` | opt-in per route |
| Health endpoint | `app/api/health/route.ts` | Fly health check, Vercel cron, on-call |
| Prometheus endpoint | `app/api/metrics/route.ts` | Grafana scraping |

## Configuration

All new env vars live in `.env.example` (T08 section). The integrations
fail open — leaving a key blank disables the integration silently so dev
/ previews don't need to provision a Sentry project or PostHog instance.

### Sentry

| Var | Scope | Purpose |
|---|---|---|
| `SENTRY_DSN` | server | Server SDK DSN |
| `NEXT_PUBLIC_SENTRY_DSN` | client | Browser SDK DSN (inlined into the bundle) |
| `SENTRY_ORG` / `SENTRY_PROJECT` / `SENTRY_AUTH_TOKEN` | build | Source-map upload during `next build` |
| `SENTRY_TRACES_RATE` | server | Tracing sample (default 0.05) |
| `NEXT_PUBLIC_SENTRY_TRACES_RATE` | client | Browser tracing sample (default 0.10) |
| `SENTRY_RELEASE` / `NEXT_PUBLIC_SENTRY_RELEASE` | both | Release identifier; falls back to `VERCEL_GIT_COMMIT_SHA` |

The `tunnelRoute: "/monitoring"` setting routes browser-side Sentry calls
through your own origin so ad-blockers don't drop error reports.

### PostHog

| Var | Scope | Purpose |
|---|---|---|
| `POSTHOG_KEY` | server | Server-side capture (signups, training events, billing) |
| `POSTHOG_HOST` | server | EU/US region (default `https://us.i.posthog.com`) |
| `NEXT_PUBLIC_POSTHOG_KEY` | client | Browser SDK key |
| `NEXT_PUBLIC_POSTHOG_HOST` | client | Browser SDK host |

Event names live in `lib/analytics.ts → Events`. Keep them there rather
than typing strings inline so PostHog funnels don't fragment.

### Metrics

| Var | Default | Purpose |
|---|---|---|
| `METRICS_TOKEN` | unset | Guards `/api/metrics`. Scraper must send `x-metrics-token: <value>` when this is set |

### Logging

`LOG_LEVEL` is one of `silent`, `error`, `warn`, `info`, `debug`,
`trace`. Defaults to `info` in production and `debug` everywhere else.
Redaction is configured in `lib/logger.ts` and covers every Clerk /
Stripe / S3 / Replicate / Sentry secret used by the project today.

## Endpoints

### `GET /api/health`

Two-tier liveness + readiness probe.

- `?mode=live` — cheap, no I/O, returns 200 as long as the Node process
  can serve a request. Use this for Docker `HEALTHCHECK` and Fly.
- default / `?mode=ready` — pings Postgres (`SELECT 1`) and Redis
  (`PING`) with a 1.5s timeout each, returns 503 on any failure.
  Includes a `metricsSummary` (requests, errors, p95 latency) so the
  on-call dashboard doesn't need to scrape `/api/metrics` for a quick view.

### `GET /api/metrics`

Prometheus text exposition by default; pass `?format=json` for the raw
snapshot. Counters + histograms come from `lib/metrics.ts`. Optional
shared-secret auth via `x-metrics-token` header.

The route wrapper (`withObservability`) automatically emits:

| Metric | Type | Labels |
|---|---|---|
| `http.requests_total` | counter | `route`, `method` |
| `http.errors_total` | counter | `route` |
| `http.request_duration_ms` | histogram | `route`, `method`, `status` |
| `worker.jobs_started_total` | counter | `name` |
| `worker.jobs_completed_total` | counter | `name` |
| `worker.jobs_failed_total` | counter | `name` |
| `worker.job_duration_ms` | histogram | `name`, `outcome` |

## Wiring a route

Opt a handler into structured logging + metrics + Sentry capture by
wrapping it with `withObservability`:

```ts
import { withObservability } from '@/lib/withObservability';

export const POST = withObservability('billing.checkout', async (req) => {
  // …business logic, free to throw — Sentry + metrics + log all happen
  // automatically.
});
```

For server-side product events, call `trackServer`:

```ts
import { Events, trackServer } from '@/lib/analytics';

trackServer({
  distinctId: userId,
  event: Events.GenerationCreated,
  properties: { promptPackId, modelId },
});
```

## Worker integration

`scripts/worker.ts` reuses the same Sentry server config, logger, metric
counters, and PostHog client as the web tier. Job lifecycle events
(`active`, `completed`, `failed`) emit a structured log line, a metric
sample, and a PostHog event (when `userId` is on the job payload).

## Local development

You can run the whole app without Sentry or PostHog — both clients no-op
when their keys are missing. The structured logger still ships to stdout
in pretty form (set `LOG_LEVEL=debug` to see everything).
