/**
 * Cost control & rate limiting (T11)
 *
 * One module that bundles four orthogonal safety nets in front of any
 * paid generation/training operation:
 *
 *   1. Global kill switch — flip-and-stop-everything for abuse incidents.
 *   2. Global daily generation cap — protects the org-wide GPU budget.
 *   3. Per-user concurrency limit — bounds in-flight jobs per user so a
 *      single user can't monopolise the queue.
 *   4. Per-user rate limit (sliding window) — bounds requests-per-minute
 *      and requests-per-day per user.
 *   5. Credit ledger — atomically debits user credits before allowing the
 *      operation; auto-refunds when the operation is released as failed.
 *
 * All state lives in Redis so the same limits hold across the worker, the
 * webhook handler, and every Next.js serverless function.
 *
 * Designed to be a single call from any expensive route:
 *   const reservation = await reserveOperation({ userId, cost: 1, op: 'generate' });
 *   if (!reservation.ok) return NextResponse.json(reservation, { status: reservation.status });
 *   try { ...do the work...; await releaseOperation(reservation, 'succeeded'); }
 *   catch (e) { await releaseOperation(reservation, 'failed'); throw e; }
 */

import IORedis, { Redis } from 'ioredis';

let _redis: Redis | null = null;
function redis(): Redis {
  if (_redis) return _redis;
  _redis = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
    maxRetriesPerRequest: 5,
    lazyConnect: false,
  });
  return _redis;
}

// ---------------------------------------------------------------------------
// Config — env-overridable, sensible defaults for an MVP.
// ---------------------------------------------------------------------------

export interface CostControlConfig {
  perUserConcurrencyLimit: number;
  perUserPerMinuteLimit: number;
  perUserPerDayLimit: number;
  globalPerDayLimit: number;
  killSwitchKey: string;
  defaultCreditCost: number;
}

function envInt(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v) return fallback;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export const COST_CONTROL_CONFIG: CostControlConfig = {
  perUserConcurrencyLimit: envInt('COST_PER_USER_CONCURRENCY', 3),
  perUserPerMinuteLimit: envInt('COST_PER_USER_PER_MINUTE', 12),
  perUserPerDayLimit: envInt('COST_PER_USER_PER_DAY', 200),
  globalPerDayLimit: envInt('COST_GLOBAL_PER_DAY', 10_000),
  killSwitchKey: 'cost:kill-switch',
  defaultCreditCost: 1,
};

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------

const todayBucket = () => new Date().toISOString().slice(0, 10); // YYYY-MM-DD
const minuteBucket = () => Math.floor(Date.now() / 60_000);

const k = {
  killSwitch: () => COST_CONTROL_CONFIG.killSwitchKey,
  userConcurrency: (userId: string) => `cost:concurrency:${userId}`,
  userMinute: (userId: string, bucket: number) => `cost:rl:min:${userId}:${bucket}`,
  userDay: (userId: string, bucket: string) => `cost:rl:day:${userId}:${bucket}`,
  globalDay: (bucket: string) => `cost:rl:global:${bucket}`,
  userCredits: (userId: string) => `cost:credits:${userId}`,
};

// ---------------------------------------------------------------------------
// Kill switch
// ---------------------------------------------------------------------------

export async function isKillSwitchEnabled(): Promise<boolean> {
  const v = await redis().get(k.killSwitch());
  return v === '1' || v === 'on' || v === 'true';
}

export async function setKillSwitch(enabled: boolean, reason?: string) {
  if (enabled) {
    await redis().set(k.killSwitch(), '1');
    if (reason) await redis().set(`${k.killSwitch()}:reason`, reason);
  } else {
    await redis().del(k.killSwitch(), `${k.killSwitch()}:reason`);
  }
}

// ---------------------------------------------------------------------------
// Credits
// ---------------------------------------------------------------------------

export async function getCredits(userId: string): Promise<number> {
  const v = await redis().get(k.userCredits(userId));
  return v === null ? 0 : Number(v);
}

export async function grantCredits(userId: string, amount: number) {
  if (amount <= 0) return getCredits(userId);
  return Number(await redis().incrby(k.userCredits(userId), amount));
}

/** Atomically debit if sufficient credits. Returns remaining balance, or null if insufficient. */
async function tryDebitCredits(userId: string, amount: number): Promise<number | null> {
  // Lua keeps the check-and-decrement atomic across concurrent requests.
  const script = `
    local current = tonumber(redis.call('GET', KEYS[1]) or '0')
    local cost = tonumber(ARGV[1])
    if current < cost then return -1 end
    redis.call('DECRBY', KEYS[1], cost)
    return current - cost
  `;
  const res = (await redis().eval(script, 1, k.userCredits(userId), String(amount))) as number;
  return res === -1 ? null : res;
}

async function refundCredits(userId: string, amount: number) {
  if (amount <= 0) return;
  await redis().incrby(k.userCredits(userId), amount);
}

// ---------------------------------------------------------------------------
// Reservation
// ---------------------------------------------------------------------------

export type ReserveDenial =
  | { ok: false; status: 503; code: 'kill-switch'; reason?: string }
  | { ok: false; status: 429; code: 'global-daily-cap'; remaining: number; limit: number }
  | { ok: false; status: 429; code: 'user-concurrency'; inFlight: number; limit: number }
  | { ok: false; status: 429; code: 'user-rate-limit'; window: 'minute' | 'day'; remaining: number; limit: number }
  | { ok: false; status: 402; code: 'insufficient-credits'; balance: number; cost: number };

export interface Reservation {
  ok: true;
  userId: string;
  op: string;
  cost: number;
  creditsRemaining: number;
  newGlobalDailyCount: number;
  reservedAt: number;
}

export interface ReserveInput {
  userId: string;
  op: string;
  cost?: number;
}

/**
 * Run the four checks in order (cheapest first) and reserve a slot if all pass.
 * Each check that does mutate state is undone if a later check fails, so a
 * denial doesn't burn a counter / credit.
 */
export async function reserveOperation(
  input: ReserveInput
): Promise<Reservation | ReserveDenial> {
  const cfg = COST_CONTROL_CONFIG;
  const cost = input.cost ?? cfg.defaultCreditCost;

  // 1. kill switch
  if (await isKillSwitchEnabled()) {
    const reason = (await redis().get(`${cfg.killSwitchKey}:reason`)) ?? undefined;
    return { ok: false, status: 503, code: 'kill-switch', reason };
  }

  // 2. global daily cap — increment first, undo on later denials
  const today = todayBucket();
  const globalKey = k.globalDay(today);
  const newGlobalCount = Number(await redis().incr(globalKey));
  if (newGlobalCount === 1) await redis().expire(globalKey, 60 * 60 * 36);
  if (newGlobalCount > cfg.globalPerDayLimit) {
    await redis().decr(globalKey);
    return {
      ok: false,
      status: 429,
      code: 'global-daily-cap',
      remaining: 0,
      limit: cfg.globalPerDayLimit,
    };
  }

  // 3. per-user minute rate limit
  const minute = minuteBucket();
  const minuteKey = k.userMinute(input.userId, minute);
  const newMinCount = Number(await redis().incr(minuteKey));
  if (newMinCount === 1) await redis().expire(minuteKey, 90);
  if (newMinCount > cfg.perUserPerMinuteLimit) {
    await redis().decr(minuteKey);
    await redis().decr(globalKey);
    return {
      ok: false,
      status: 429,
      code: 'user-rate-limit',
      window: 'minute',
      remaining: 0,
      limit: cfg.perUserPerMinuteLimit,
    };
  }

  // 4. per-user day rate limit
  const dayKey = k.userDay(input.userId, today);
  const newDayCount = Number(await redis().incr(dayKey));
  if (newDayCount === 1) await redis().expire(dayKey, 60 * 60 * 36);
  if (newDayCount > cfg.perUserPerDayLimit) {
    await redis().decr(dayKey);
    await redis().decr(minuteKey);
    await redis().decr(globalKey);
    return {
      ok: false,
      status: 429,
      code: 'user-rate-limit',
      window: 'day',
      remaining: 0,
      limit: cfg.perUserPerDayLimit,
    };
  }

  // 5. per-user concurrency
  const concKey = k.userConcurrency(input.userId);
  const newConc = Number(await redis().incr(concKey));
  // Safety expiry so a stuck reservation can't pin the user out forever.
  if (newConc === 1) await redis().expire(concKey, 60 * 60);
  if (newConc > cfg.perUserConcurrencyLimit) {
    await redis().decr(concKey);
    await redis().decr(dayKey);
    await redis().decr(minuteKey);
    await redis().decr(globalKey);
    return {
      ok: false,
      status: 429,
      code: 'user-concurrency',
      inFlight: newConc - 1,
      limit: cfg.perUserConcurrencyLimit,
    };
  }

  // 6. credit debit (atomic via Lua)
  const remaining = await tryDebitCredits(input.userId, cost);
  if (remaining === null) {
    await redis().decr(concKey);
    await redis().decr(dayKey);
    await redis().decr(minuteKey);
    await redis().decr(globalKey);
    return {
      ok: false,
      status: 402,
      code: 'insufficient-credits',
      balance: await getCredits(input.userId),
      cost,
    };
  }

  return {
    ok: true,
    userId: input.userId,
    op: input.op,
    cost,
    creditsRemaining: remaining,
    newGlobalDailyCount: newGlobalCount,
    reservedAt: Date.now(),
  };
}

/**
 * Release a reservation. On 'failed' the credits are refunded so a user
 * isn't charged for a generation we couldn't deliver. The rate-limit and
 * daily counters are NOT rolled back — those count attempts, not successes.
 */
export async function releaseOperation(
  reservation: Reservation,
  outcome: 'succeeded' | 'failed' | 'canceled'
) {
  await redis().decr(k.userConcurrency(reservation.userId));
  if (outcome !== 'succeeded') {
    await refundCredits(reservation.userId, reservation.cost);
  }
}

// ---------------------------------------------------------------------------
// Read-only inspector — useful for admin panels & health checks.
// ---------------------------------------------------------------------------

export async function getCostControlSnapshot(userId?: string) {
  const today = todayBucket();
  const minute = minuteBucket();

  const killSwitch = await isKillSwitchEnabled();
  const killReason = killSwitch
    ? (await redis().get(`${COST_CONTROL_CONFIG.killSwitchKey}:reason`)) ?? null
    : null;

  const globalDay = Number((await redis().get(k.globalDay(today))) ?? 0);

  let user: Record<string, unknown> | undefined;
  if (userId) {
    const [concurrency, dayCount, minCount, credits] = await Promise.all([
      redis().get(k.userConcurrency(userId)),
      redis().get(k.userDay(userId, today)),
      redis().get(k.userMinute(userId, minute)),
      redis().get(k.userCredits(userId)),
    ]);
    user = {
      userId,
      concurrency: Number(concurrency ?? 0),
      perDay: Number(dayCount ?? 0),
      perMinute: Number(minCount ?? 0),
      credits: Number(credits ?? 0),
    };
  }

  return {
    config: COST_CONTROL_CONFIG,
    killSwitch: { enabled: killSwitch, reason: killReason },
    global: { perDay: globalDay, perDayLimit: COST_CONTROL_CONFIG.globalPerDayLimit },
    user,
  };
}
