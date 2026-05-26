import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { getUser, gdprEraseUser } from '@/lib/admin-store';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const { id } = await params;
  const user = await getUser(id);
  if (!user) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ user });
}

/**
 * DELETE /api/admin/users/[id] — GDPR-compliant erasure.
 * Deletes the user, all their models, and writes an audit record.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const { id } = await params;
  const initiatedBy =
    req.headers.get('x-admin-actor') ?? 'unknown-admin';
  const reason = req.nextUrl.searchParams.get('reason') ?? undefined;
  const record = await gdprEraseUser({ userId: id, initiatedBy, reason });
  return NextResponse.json({ ok: true, erasure: record });
}
