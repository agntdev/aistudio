import { NextRequest, NextResponse } from 'next/server';
import {
  reserveOperation,
  releaseOperation,
  type Reservation,
} from '@/lib/cost-control';

/**
 * POST /api/generations/create
 *
 * Real generation backend lives in T04; this route exists so the
 * end-to-end cost-control flow (kill-switch / concurrency / rate-limit /
 * credits) is exercisable today. On a real merge with T04 the body of
 * the try{} block becomes the actual generation kick-off.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const userId = typeof body.userId === 'string' ? body.userId : null;
  const prompt = typeof body.prompt === 'string' ? body.prompt : null;

  if (!userId || !prompt) {
    return NextResponse.json(
      { error: 'userId and prompt are required' },
      { status: 400 }
    );
  }

  const reservation = await reserveOperation({
    userId,
    op: 'generate',
    cost: 1,
  });

  if (!reservation.ok) {
    return NextResponse.json(reservation, { status: reservation.status });
  }

  const ok = reservation as Reservation;

  try {
    // T04 hook: enqueue the real generation job here. For now we just
    // echo back the reservation so callers can verify the wiring.
    const generationId = `gen_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    await releaseOperation(ok, 'succeeded');

    return NextResponse.json({
      ok: true,
      generationId,
      creditsRemaining: ok.creditsRemaining,
      globalDailyCount: ok.newGlobalDailyCount,
    });
  } catch (err: unknown) {
    await releaseOperation(ok, 'failed');
    const message = err instanceof Error ? err.message : 'unknown';
    return NextResponse.json(
      { error: 'Generation failed; credits refunded', detail: message },
      { status: 500 }
    );
  }
}
