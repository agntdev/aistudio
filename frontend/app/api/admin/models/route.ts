import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { deleteModel, listModels, recordModel } from '@/lib/admin-store';

export async function GET(req: NextRequest) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  return NextResponse.json({ models: await listModels() });
}

export async function POST(req: NextRequest) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const action = body.action;

  if (action === 'delete') {
    const id = typeof body.modelId === 'string' ? body.modelId : null;
    if (!id) return NextResponse.json({ error: 'modelId required' }, { status: 400 });
    const ok = await deleteModel(id);
    return NextResponse.json({ ok }, { status: ok ? 200 : 404 });
  }
  if (action === 'register') {
    const id = typeof body.modelId === 'string' ? body.modelId : null;
    const userId = typeof body.userId === 'string' ? body.userId : null;
    const name = typeof body.name === 'string' ? body.name : 'model';
    if (!id || !userId) return NextResponse.json({ error: 'modelId+userId required' }, { status: 400 });
    await recordModel({
      id,
      userId,
      name,
      status: 'active',
      createdAt: new Date().toISOString(),
    });
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: 'unknown action' }, { status: 400 });
}
