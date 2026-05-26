/**
 * Postgres client (T09).
 *
 * Lazy-initialised so cold-starts don't pay the connection cost until
 * a route actually needs the database. Returns a singleton `Pool` so
 * we don't exhaust connections under load on a serverless platform.
 */

import { Pool, type PoolConfig } from 'pg';

let _pool: Pool | null = null;

export function getDb(): Pool {
  if (_pool) return _pool;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL must be set');
  }
  const config: PoolConfig = {
    connectionString: url,
    max: Number(process.env.DATABASE_POOL_MAX || '10'),
    idleTimeoutMillis: 30_000,
  };
  // Enable TLS for managed providers (RDS, Supabase, Neon) unless the
  // URL already specifies sslmode or it's an obvious local connection.
  if (!url.includes('sslmode=') && !url.includes('localhost') && !url.includes('127.0.0.1')) {
    config.ssl = { rejectUnauthorized: false };
  }
  _pool = new Pool(config);
  return _pool;
}

export async function pingDb(): Promise<{ ok: boolean; latencyMs?: number; detail?: string }> {
  const startedAt = Date.now();
  try {
    const db = getDb();
    const res = await db.query('SELECT 1 AS ok');
    if (res.rows[0]?.ok !== 1) {
      return { ok: false, detail: 'unexpected ping result' };
    }
    return { ok: true, latencyMs: Date.now() - startedAt };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}
