import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

/**
 * Admin auth guard (T07).
 *
 * The MVP enforces a shared secret in the `x-admin-token` header so the
 * admin endpoints work without a Clerk role being provisioned. Returns
 * 503 if the env var isn't set (fail-closed) and 401 on mismatch.
 *
 * In production this should be replaced by a Clerk `org:admin` role
 * check; the wrapping pattern stays the same so the swap is one file.
 */
export function requireAdmin(req: NextRequest): NextResponse | null {
  const expected = process.env.ADMIN_API_TOKEN || process.env.COST_CONTROL_ADMIN_TOKEN;
  if (!expected) {
    return NextResponse.json(
      { error: 'ADMIN_API_TOKEN must be configured for admin endpoints' },
      { status: 503 }
    );
  }
  const supplied = req.headers.get('x-admin-token');
  if (supplied !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  return null;
}

export function requireAdminClient(token: string | null): boolean {
  return !!token && token.length > 0;
}
