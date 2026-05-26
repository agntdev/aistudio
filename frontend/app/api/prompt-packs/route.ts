import { NextResponse } from 'next/server';
import { listPromptPacks } from '@/lib/prompt-packs';

/**
 * GET /api/prompt-packs
 *
 * Returns the available prompt packs (without expanding templates). The
 * frontend uses this to render the pack-picker cards on the generation
 * page.
 */
export async function GET() {
  return NextResponse.json({ packs: listPromptPacks() });
}
