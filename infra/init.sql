-- Postgres schema bootstrap for AIStudio (T09).
--
-- Loaded automatically by docker-compose on first start, and by the
-- `npm run migrate` script in CI. Idempotent: every CREATE uses IF NOT
-- EXISTS so re-running the same script is safe.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS users (
  id              TEXT PRIMARY KEY,
  email           TEXT UNIQUE,
  status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'suspended', 'deleted')),
  suspended_reason TEXT,
  credits         INTEGER NOT NULL DEFAULT 0,
  total_refunds_cents INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS models (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  trigger_word    TEXT NOT NULL,
  replicate_training_id TEXT,
  status          TEXT NOT NULL DEFAULT 'training'
                    CHECK (status IN ('training', 'ready', 'failed', 'deleted')),
  weights_url     TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS models_user_id_idx ON models(user_id);
CREATE INDEX IF NOT EXISTS models_status_idx ON models(status);

CREATE TABLE IF NOT EXISTS generations (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  model_id        TEXT REFERENCES models(id) ON DELETE SET NULL,
  prompt          TEXT NOT NULL,
  prompt_pack     TEXT,
  status          TEXT NOT NULL DEFAULT 'queued'
                    CHECK (status IN ('queued', 'processing', 'succeeded', 'failed')),
  image_url       TEXT,
  width           INTEGER,
  height          INTEGER,
  duration_ms     INTEGER,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS generations_user_id_created_idx
  ON generations(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS refunds (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id),
  amount_cents    INTEGER NOT NULL CHECK (amount_cents > 0),
  reason          TEXT NOT NULL,
  processed_by    TEXT NOT NULL,
  stripe_refund_id TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS refunds_user_id_idx ON refunds(user_id);

CREATE TABLE IF NOT EXISTS abuse_events (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL,
  kind            TEXT NOT NULL,
  detail          TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS abuse_events_user_id_idx ON abuse_events(user_id);

CREATE TABLE IF NOT EXISTS gdpr_erasures (
  id              TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::text,
  user_id         TEXT NOT NULL,
  initiated_by    TEXT NOT NULL,
  reason          TEXT,
  models_deleted  INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
