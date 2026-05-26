/**
 * Admin store (T07).
 *
 * Redis-backed persistence for everything the admin panel cares about:
 * users, trained models, refund ledger, abuse events, and a GDPR
 * erasure audit log. Each entity is a flat hash keyed by id so the API
 * routes can stay thin.
 *
 * Real prod would use Postgres; until that arrives, Redis is sufficient
 * for the dashboard to be operable end-to-end.
 */

import IORedis, { Redis } from 'ioredis';

let _redis: Redis | null = null;
function redis(): Redis {
  if (_redis) return _redis;
  _redis = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
    maxRetriesPerRequest: 5,
  });
  return _redis;
}

const k = {
  user: (id: string) => `admin:user:${id}`,
  userIndex: 'admin:users',
  model: (id: string) => `admin:model:${id}`,
  modelIndex: 'admin:models',
  modelsByUser: (userId: string) => `admin:models:byuser:${userId}`,
  refunds: 'admin:refunds',
  refundsByUser: (userId: string) => `admin:refunds:byuser:${userId}`,
  abuse: 'admin:abuse',
  gdprLog: 'admin:gdpr',
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AdminUser {
  id: string;
  email?: string;
  status: 'active' | 'suspended' | 'deleted';
  suspendedReason?: string;
  createdAt: string;
  modelsCount: number;
  totalRefundsCents: number;
}

export interface AdminModel {
  id: string;
  userId: string;
  name: string;
  status: 'active' | 'deleted';
  createdAt: string;
}

export interface RefundRecord {
  id: string;
  userId: string;
  amountCents: number;
  reason: string;
  processedBy: string;
  createdAt: string;
}

export interface AbuseEvent {
  id: string;
  userId: string;
  kind: 'nsfw-upload' | 'prompt-block' | 'rate-limit' | 'liveness-fail' | 'other';
  detail: string;
  createdAt: string;
}

export interface GdprEraseRecord {
  userId: string;
  initiatedBy: string;
  reason?: string;
  modelsDeleted: number;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export async function listUsers(): Promise<AdminUser[]> {
  const ids = await redis().smembers(k.userIndex);
  if (ids.length === 0) return [];
  const pipeline = redis().pipeline();
  for (const id of ids) pipeline.hgetall(k.user(id));
  const results = await pipeline.exec();
  return (
    results
      ?.map(([, raw]) => raw as Record<string, string> | null)
      .filter((r): r is Record<string, string> => !!r && !!r.id)
      .map(deserializeUser) ?? []
  );
}

export async function getUser(id: string): Promise<AdminUser | null> {
  const raw = await redis().hgetall(k.user(id));
  if (!raw || !raw.id) return null;
  return deserializeUser(raw);
}

export async function upsertUser(input: Partial<AdminUser> & { id: string }) {
  const existing = await getUser(input.id);
  const merged: AdminUser = {
    id: input.id,
    email: input.email ?? existing?.email,
    status: input.status ?? existing?.status ?? 'active',
    suspendedReason: input.suspendedReason ?? existing?.suspendedReason,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
    modelsCount: input.modelsCount ?? existing?.modelsCount ?? 0,
    totalRefundsCents: input.totalRefundsCents ?? existing?.totalRefundsCents ?? 0,
  };
  await redis().sadd(k.userIndex, input.id);
  await redis().hmset(k.user(input.id), serializeUser(merged));
  return merged;
}

export async function suspendUser(id: string, reason: string) {
  return upsertUser({ id, status: 'suspended', suspendedReason: reason });
}

export async function unsuspendUser(id: string) {
  await redis().hdel(k.user(id), 'suspendedReason');
  return upsertUser({ id, status: 'active' });
}

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------

export async function listModels(): Promise<AdminModel[]> {
  const ids = await redis().smembers(k.modelIndex);
  if (ids.length === 0) return [];
  const pipeline = redis().pipeline();
  for (const id of ids) pipeline.hgetall(k.model(id));
  const results = await pipeline.exec();
  return (
    results
      ?.map(([, raw]) => raw as Record<string, string> | null)
      .filter((r): r is Record<string, string> => !!r && !!r.id)
      .map((r) => ({
        id: r.id,
        userId: r.userId,
        name: r.name,
        status: r.status as AdminModel['status'],
        createdAt: r.createdAt,
      })) ?? []
  );
}

export async function deleteModel(id: string) {
  const raw = await redis().hgetall(k.model(id));
  if (!raw?.id) return false;
  await redis().hset(k.model(id), 'status', 'deleted');
  if (raw.userId) {
    const user = await getUser(raw.userId);
    if (user) await upsertUser({ id: user.id, modelsCount: Math.max(0, user.modelsCount - 1) });
  }
  return true;
}

export async function recordModel(model: AdminModel) {
  await redis().sadd(k.modelIndex, model.id);
  await redis().sadd(k.modelsByUser(model.userId), model.id);
  await redis().hmset(k.model(model.id), {
    id: model.id,
    userId: model.userId,
    name: model.name,
    status: model.status,
    createdAt: model.createdAt,
  });
}

// ---------------------------------------------------------------------------
// Refunds
// ---------------------------------------------------------------------------

export async function processRefund(input: Omit<RefundRecord, 'id' | 'createdAt'>) {
  const record: RefundRecord = {
    ...input,
    id: `refund_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
  };
  await redis().lpush(k.refunds, JSON.stringify(record));
  await redis().lpush(k.refundsByUser(input.userId), JSON.stringify(record));
  // Update user's running total.
  const user = await getUser(input.userId);
  if (user) {
    await upsertUser({
      id: user.id,
      totalRefundsCents: user.totalRefundsCents + input.amountCents,
    });
  }
  return record;
}

export async function listRefunds(limit = 50): Promise<RefundRecord[]> {
  const rows = await redis().lrange(k.refunds, 0, limit - 1);
  return rows.map((r) => JSON.parse(r) as RefundRecord);
}

// ---------------------------------------------------------------------------
// Abuse monitoring
// ---------------------------------------------------------------------------

export async function recordAbuseEvent(input: Omit<AbuseEvent, 'id' | 'createdAt'>) {
  const event: AbuseEvent = {
    ...input,
    id: `abuse_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
  };
  await redis().lpush(k.abuse, JSON.stringify(event));
  return event;
}

export async function listAbuseEvents(limit = 50): Promise<AbuseEvent[]> {
  const rows = await redis().lrange(k.abuse, 0, limit - 1);
  return rows.map((r) => JSON.parse(r) as AbuseEvent);
}

// ---------------------------------------------------------------------------
// GDPR erasure
// ---------------------------------------------------------------------------

/**
 * Hard-delete a user and their associated models. Writes an audit
 * record so an auditor can later confirm the erasure.
 *
 * Note: in real prod this would also need to delete S3 objects and any
 * Postgres rows referencing the user; this layer only handles the
 * admin-store side.
 */
export async function gdprEraseUser(input: {
  userId: string;
  initiatedBy: string;
  reason?: string;
}): Promise<GdprEraseRecord> {
  const userId = input.userId;

  const modelIds = await redis().smembers(k.modelsByUser(userId));
  for (const id of modelIds) {
    await redis().del(k.model(id));
    await redis().srem(k.modelIndex, id);
  }
  await redis().del(k.modelsByUser(userId));

  // Tombstone the user record so we keep audit trail without PII.
  await redis().del(k.user(userId));
  await redis().srem(k.userIndex, userId);

  const record: GdprEraseRecord = {
    userId,
    initiatedBy: input.initiatedBy,
    reason: input.reason,
    modelsDeleted: modelIds.length,
    createdAt: new Date().toISOString(),
  };
  await redis().lpush(k.gdprLog, JSON.stringify(record));
  return record;
}

export async function listGdprErasures(limit = 50): Promise<GdprEraseRecord[]> {
  const rows = await redis().lrange(k.gdprLog, 0, limit - 1);
  return rows.map((r) => JSON.parse(r) as GdprEraseRecord);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function serializeUser(u: AdminUser): Record<string, string> {
  const out: Record<string, string> = {
    id: u.id,
    status: u.status,
    createdAt: u.createdAt,
    modelsCount: String(u.modelsCount),
    totalRefundsCents: String(u.totalRefundsCents),
  };
  if (u.email) out.email = u.email;
  if (u.suspendedReason) out.suspendedReason = u.suspendedReason;
  return out;
}

function deserializeUser(raw: Record<string, string>): AdminUser {
  return {
    id: raw.id,
    email: raw.email,
    status: (raw.status as AdminUser['status']) ?? 'active',
    suspendedReason: raw.suspendedReason,
    createdAt: raw.createdAt ?? new Date().toISOString(),
    modelsCount: Number(raw.modelsCount ?? '0'),
    totalRefundsCents: Number(raw.totalRefundsCents ?? '0'),
  };
}
