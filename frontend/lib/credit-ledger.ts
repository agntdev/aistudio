/**
 * Credit ledger (T05)
 *
 * PostgreSQL-backed audit trail for every credit movement. Every debit,
 * credit, grant, or refund writes an immutable row so the platform can
 * answer "where did these credits come from?" without scraping logs.
 *
 * Redis remains the hot-path credit counter (see cost-control.ts). This
 * module is the cold-path audit log — written after Redis is updated.
 */

import { getDb } from '@/lib/db';

export type LedgerReason =
  | 'free_tier'
  | 'purchase'
  | 'refund'
  | 'generation'
  | 'admin_grant'
  | 'admin_deduction'
  | 'subscription_renewal';

export interface LedgerEntry {
  id: string;
  userId: string;
  amount: number; // positive = credit, negative = debit
  balanceAfter: number;
  reason: LedgerReason;
  stripeSessionId?: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
}

export async function recordLedgerEntry(input: {
  userId: string;
  amount: number;
  balanceAfter: number;
  reason: LedgerReason;
  stripeSessionId?: string;
  metadata?: Record<string, unknown>;
}): Promise<LedgerEntry> {
  const db = getDb();
  const result = await db.query<LedgerEntry>(
    `INSERT INTO credit_ledger (user_id, amount, balance_after, reason, stripe_session_id, metadata)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, user_id AS "userId", amount, balance_after AS "balanceAfter",
               reason, stripe_session_id AS "stripeSessionId", metadata, created_at AS "createdAt"`,
    [
      input.userId,
      input.amount,
      input.balanceAfter,
      input.reason,
      input.stripeSessionId ?? null,
      input.metadata ? JSON.stringify(input.metadata) : null,
    ]
  );
  return result.rows[0];
}

export async function getLedgerForUser(
  userId: string,
  limit = 50,
  offset = 0
): Promise<LedgerEntry[]> {
  const db = getDb();
  const result = await db.query<LedgerEntry>(
    `SELECT id, user_id AS "userId", amount, balance_after AS "balanceAfter",
            reason, stripe_session_id AS "stripeSessionId", metadata, created_at AS "createdAt"
     FROM credit_ledger
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT $2 OFFSET $3`,
    [userId, limit, offset]
  );
  return result.rows;
}

export async function hasReceivedFreeTier(userId: string): Promise<boolean> {
  const db = getDb();
  const result = await db.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM credit_ledger
       WHERE user_id = $1 AND reason = 'free_tier'
     ) AS "exists"`,
    [userId]
  );
  return result.rows[0]?.exists ?? false;
}
