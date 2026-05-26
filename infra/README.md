# Infrastructure & Deployment (T09)

This directory and the sibling Docker / workflow files cover the
deployable shape of AIStudio.

## Local development

```bash
# Bring up Postgres, Redis, and MinIO (S3-compatible) in the background.
docker compose up -d postgres redis minio

# Run the Next.js app with hot reload.
cd frontend && npm install && npm run dev

# Run the BullMQ training worker in a second terminal.
cd frontend && npm run worker
```

Then visit http://localhost:3000.
MinIO console: http://localhost:9001 (`minioadmin` / `minioadmin`).

To stand up the production-mode containers too:

```bash
docker compose --profile full up --build
```

## Production deployment

| Component | Host    | Image / config                 |
|-----------|---------|--------------------------------|
| Frontend  | Vercel  | `vercel.json` + Next.js build  |
| Worker    | Fly.io  | `fly.toml` + `Dockerfile.worker`|
| Postgres  | Supabase / Neon / RDS | URL via `DATABASE_URL` |
| Redis     | Upstash / Fly Redis   | URL via `REDIS_URL`    |
| S3        | AWS S3 / DO Spaces    | env in `.env.example`  |
| CDN       | Vercel Edge (frontend) + S3 + CloudFront (assets) | — |

### One-time setup

```bash
# Vercel
vercel link
vercel env add CLERK_SECRET_KEY production
vercel env add DATABASE_URL production
vercel env add REDIS_URL production
vercel env add S3_ACCESS_KEY_ID production
vercel env add S3_SECRET_ACCESS_KEY production
vercel env add S3_BUCKET production
vercel env add ADMIN_API_TOKEN production
vercel env add METRICS_TOKEN production
vercel env add SENTRY_DSN production
vercel env add POSTHOG_API_KEY production
vercel env add REPLICATE_API_TOKEN production

# Fly.io worker
flyctl launch --copy-config --no-deploy
flyctl secrets set \
  REDIS_URL=... \
  DATABASE_URL=... \
  REPLICATE_API_TOKEN=... \
  REPLICATE_DESTINATION=aistudio/user-lora \
  NEXT_PUBLIC_APP_URL=https://aistudio.app
```

### CI/CD

`.github/workflows/ci.yml` runs on every PR and push to main:

1. Type-check + build the Next.js app
2. Build Docker images (frontend + worker) on push to main

`.github/workflows/deploy.yml` deploys on push to main:

1. Vercel — frontend (gated on `VERCEL_TOKEN` secret)
2. Fly.io — worker (gated on `FLY_API_TOKEN` secret)

Both jobs are no-ops if the respective tokens aren't configured, so the
pipeline runs cleanly on forks.

### Health checks

- `GET /api/health` — liveness (no externals)
- `GET /api/health/ready` — readiness (pings Redis, Postgres)

Vercel cron in `vercel.json` hits `/api/health/ready` every 5 min so the
observability stack (T08) catches dependency outages without a separate
uptime monitor.

## Schema

`infra/init.sql` is the canonical Postgres schema. It's loaded
automatically by the `docker-compose` Postgres container on first start
and can be applied to managed databases via:

```bash
psql "$DATABASE_URL" -f infra/init.sql
```
