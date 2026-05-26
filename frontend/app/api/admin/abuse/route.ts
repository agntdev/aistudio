import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { listAbuseEvents, recordAbuseEvent } from '@/lib/admin-store';

export async function GET(req: NextRequest) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  return NextResponse.json({ events: await listAbuseEvents() });
}

export async function POST(req: NextRequest) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const userId = typeof body.userId === 'string' ? body.userId : null;
  const kind = typeof body.kind === 'string' ? body.kind : null;
  const detail = typeof body.detail === 'string' ? body.detail : '';
  const allowedKinds = new Set([
    'nsfw-upload', 'prompt-block', 'rate-limit', 'liveness-fail', 'other',
  ]);
  if (!userId || !kind || !allowedKinds.has(kind)) {
    return NextResponse.json(
      { error: 'userId and a valid kind are required' },
      { status: 400 }
    );
  }
  return NextResponse.json({
    ok: true,
    event: await recordAbuseEvent({ userId, kind: kind as 'nsfw-upload' | 'prompt-block' | 'rate-limit' | 'liveness-fail' | 'other', detail }),
  });
}
