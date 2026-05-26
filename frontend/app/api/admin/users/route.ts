import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import {
  listUsers,
  suspendUser,
  unsuspendUser,
  upsertUser,
} from '@/lib/admin-store';

export async function GET(req: NextRequest) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  return NextResponse.json({ users: await listUsers() });
}

export async function POST(req: NextRequest) {
  const denied = requireAdmin(req);
  if (denied) return denied;

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const action = body.action;
  const userId = typeof body.userId === 'string' ? body.userId : null;

  if (!userId) {
    return NextResponse.json({ error: 'userId required' }, { status: 400 });
  }

  if (action === 'suspend') {
    const reason = typeof body.reason === 'string' ? body.reason : 'admin action';
    return NextResponse.json({ ok: true, user: await suspendUser(userId, reason) });
  }
  if (action === 'unsuspend') {
    return NextResponse.json({ ok: true, user: await unsuspendUser(userId) });
  }
  if (action === 'create') {
    return NextResponse.json({
      ok: true,
      user: await upsertUser({
        id: userId,
        email: typeof body.email === 'string' ? body.email : undefined,
      }),
    });
  }
  return NextResponse.json(
    { error: 'unknown action; expected create | suspend | unsuspend' },
    { status: 400 }
  );
}
