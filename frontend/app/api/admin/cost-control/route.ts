import { NextRequest, NextResponse } from 'next/server';
import {
  getCostControlSnapshot,
  grantCredits,
  setKillSwitch,
} from '@/lib/cost-control';

/**
 * Admin / ops endpoint for T11.
 *
 *   GET  /api/admin/cost-control?userId=... → snapshot of config + counters
 *   POST /api/admin/cost-control { action: 'kill', reason?: string }
 *   POST /api/admin/cost-control { action: 'unkill' }
 *   POST /api/admin/cost-control { action: 'grant', userId, amount }
 *
 * In production this route MUST be guarded by an admin auth check (Clerk
 * role / signed JWT). We enforce a shared secret as a first cordon and
 * fail closed if the secret env var is unset.
 */

function checkAuth(req: NextRequest): NextResponse | null {
  const expected = process.env.COST_CONTROL_ADMIN_TOKEN;
  if (!expected) {
    return NextResponse.json(
      { error: 'COST_CONTROL_ADMIN_TOKEN must be set to use the admin endpoint' },
      { status: 503 }
    );
  }
  const supplied = req.headers.get('x-admin-token');
  if (supplied !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  return null;
}

export async function GET(req: NextRequest) {
  const denied = checkAuth(req);
  if (denied) return denied;
  const { searchParams } = new URL(req.url);
  const userId = searchParams.get('userId') ?? undefined;
  return NextResponse.json(await getCostControlSnapshot(userId));
}

export async function POST(req: NextRequest) {
  const denied = checkAuth(req);
  if (denied) return denied;

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const action = typeof body.action === 'string' ? body.action : null;

  switch (action) {
    case 'kill': {
      const reason = typeof body.reason === 'string' ? body.reason : undefined;
      await setKillSwitch(true, reason);
      return NextResponse.json({ ok: true, killSwitch: true, reason });
    }
    case 'unkill': {
      await setKillSwitch(false);
      return NextResponse.json({ ok: true, killSwitch: false });
    }
    case 'grant': {
      const userId = typeof body.userId === 'string' ? body.userId : null;
      const amount = typeof body.amount === 'number' ? body.amount : null;
      if (!userId || !amount || amount <= 0) {
        return NextResponse.json(
          { error: 'grant requires userId and positive amount' },
          { status: 400 }
        );
      }
      const balance = await grantCredits(userId, amount);
      return NextResponse.json({ ok: true, userId, balance });
    }
    default:
      return NextResponse.json(
        { error: 'unknown action; expected kill | unkill | grant' },
        { status: 400 }
      );
  }
}
