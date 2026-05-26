import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/generations
 *
 * Returns a paginated list of the current user's generations.
 *
 * Query params:
 *   ?page=1 — 1-indexed
 *   ?pageSize=12 — items per page (max 60)
 *   ?status=succeeded|processing|failed — optional filter
 *
 * The persistence layer (Postgres + S3 keys) lives in T04. Until that
 * lands, this endpoint serves a deterministic in-memory fixture so the
 * gallery UI is fully exercisable end-to-end.
 */

export type GenerationStatus = 'succeeded' | 'processing' | 'failed' | 'queued';

export interface GenerationDTO {
  id: string;
  promptPack: string;
  prompt: string;
  status: GenerationStatus;
  progress: number;
  imageUrl: string | null;
  thumbnailUrl: string | null;
  width: number;
  height: number;
  createdAt: string;
  durationMs?: number;
  modelTriggerWord: string;
}

const PROMPT_PACKS = [
  'Studio Portrait', 'Cinematic', 'Editorial Fashion', 'Street Style',
  'Vintage Film', 'Cyberpunk Neon', 'Beach Sunset', 'Black & White',
];

function pickFromHash(seed: number, list: readonly string[]) {
  return list[Math.abs(seed) % list.length];
}

function buildFixture(count: number): GenerationDTO[] {
  const out: GenerationDTO[] = [];
  const now = Date.now();
  for (let i = 0; i < count; i++) {
    const seed = i + 1;
    // Deterministic image URLs from picsum.photos using the seed so the
    // gallery shows stable thumbnails between requests.
    const w = 768;
    const h = 1024;
    const status: GenerationStatus =
      i === 0 ? 'processing' : i === 1 ? 'queued' : i % 17 === 0 ? 'failed' : 'succeeded';
    const progress = status === 'processing' ? 60 : status === 'queued' ? 0 : 100;
    out.push({
      id: `gen_${String(seed).padStart(6, '0')}`,
      promptPack: pickFromHash(seed * 7, PROMPT_PACKS),
      prompt: `Portrait of TOK as a ${pickFromHash(seed * 3, PROMPT_PACKS).toLowerCase()} subject, dramatic lighting`,
      status,
      progress,
      imageUrl:
        status === 'succeeded'
          ? `https://picsum.photos/seed/aistudio-${seed}/${w}/${h}`
          : null,
      thumbnailUrl:
        status === 'succeeded'
          ? `https://picsum.photos/seed/aistudio-${seed}/384/512`
          : null,
      width: w,
      height: h,
      createdAt: new Date(now - seed * 1000 * 60 * 17).toISOString(),
      durationMs: status === 'succeeded' ? 18000 + (seed % 9) * 1500 : undefined,
      modelTriggerWord: 'TOK',
    });
  }
  return out;
}

const FIXTURE_TOTAL = 47;
const ALL_FIXTURE = buildFixture(FIXTURE_TOTAL);

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const page = Math.max(1, Number(searchParams.get('page') || '1'));
  const pageSize = Math.min(60, Math.max(1, Number(searchParams.get('pageSize') || '12')));
  const statusFilter = searchParams.get('status') as GenerationStatus | null;

  const filtered = statusFilter
    ? ALL_FIXTURE.filter((g) => g.status === statusFilter)
    : ALL_FIXTURE;

  const start = (page - 1) * pageSize;
  const end = start + pageSize;
  const items = filtered.slice(start, end);

  return NextResponse.json({
    items,
    page,
    pageSize,
    total: filtered.length,
    hasMore: end < filtered.length,
  });
}
