import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { listRefunds, processRefund } from '@/lib/admin-store';

export async function GET(req: NextRequest) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  return NextResponse.json({ refunds: await listRefunds() });
}

export async function POST(req: NextRequest) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const userId = typeof body.userId === 'string' ? body.userId : null;
  const amountCents = typeof body.amountCents === 'number' ? body.amountCents : null;
  const reason = typeof body.reason === 'string' ? body.reason : null;
  const processedBy =
    req.headers.get('x-admin-actor') ?? 'unknown-admin';

  if (!userId || !amountCents || amountCents <= 0 || !reason) {
    return NextResponse.json(
      { error: 'userId, positive amountCents, and reason are required' },
      { status: 400 }
    );
  }
  return NextResponse.json({
    ok: true,
    refund: await processRefund({ userId, amountCents, reason, processedBy }),
  });
}
