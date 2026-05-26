import { NextRequest } from 'next/server';

/**
 * GET /api/generations/stream?ids=gen_000001,gen_000002
 *
 * Server-Sent Events stream that pushes progress/status updates for the
 * listed generation ids until they reach a terminal state.
 *
 * Until T04 ships a real generation backend, this simulates a job
 * progressing from queued -> processing -> succeeded so the gallery UI's
 * live-update path is fully exercised.
 */

export const dynamic = 'force-dynamic';

interface FakeJobState {
  id: string;
  status: 'queued' | 'processing' | 'succeeded' | 'failed';
  progress: number;
  imageUrl: string | null;
}

function seedImage(id: string) {
  return `https://picsum.photos/seed/aistudio-stream-${id}/768/1024`;
}

function buildInitialState(ids: string[]): FakeJobState[] {
  return ids.map((id, idx) => ({
    id,
    status: idx === 0 ? 'processing' : 'queued',
    progress: idx === 0 ? 10 : 0,
    imageUrl: null,
  }));
}

function advance(state: FakeJobState): FakeJobState {
  if (state.status === 'succeeded' || state.status === 'failed') return state;

  if (state.status === 'queued') {
    return { ...state, status: 'processing', progress: 5 };
  }

  const next = Math.min(100, state.progress + 12 + Math.floor(Math.random() * 8));
  if (next >= 100) {
    return { ...state, status: 'succeeded', progress: 100, imageUrl: seedImage(state.id) };
  }
  return { ...state, progress: next };
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const ids = (searchParams.get('ids') || '').split(',').filter(Boolean);

  if (ids.length === 0) {
    return new Response('ids query param required', { status: 400 });
  }

  const encoder = new TextEncoder();
  let jobs = buildInitialState(ids);

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
        );
      };

      send('snapshot', jobs);

      const interval = setInterval(() => {
        jobs = jobs.map(advance);
        send('progress', jobs);

        const allDone = jobs.every(
          (j) => j.status === 'succeeded' || j.status === 'failed'
        );
        if (allDone) {
          send('done', { jobs });
          clearInterval(interval);
          controller.close();
        }
      }, 1000);

      req.signal.addEventListener('abort', () => {
        clearInterval(interval);
        try { controller.close(); } catch {}
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
