/**
 * Server-side image processing for generated outputs (T04).
 *
 * Responsibilities:
 *   - Thumbnail generation (a 512px-wide variant for gallery tiles).
 *   - Optional watermarking (free-tier outputs get a subtle bottom-right
 *     mark; paid users get the raw render).
 *
 * Uses `sharp` which is the standard high-performance image processor
 * on Node. Heavy enough that we only import it inside the helpers so
 * tree-shaking can drop it from edge bundles.
 */

import type sharpType from 'sharp';

type SharpModule = typeof sharpType;
type SharpInstance = ReturnType<SharpModule>;

let _sharpCtor: SharpModule | null = null;
async function loadSharp(): Promise<SharpModule> {
  if (_sharpCtor) return _sharpCtor;
  // Lazy import — `sharp` ships native binaries we don't want bundled
  // into the Edge runtime.
  const mod = (await import('sharp')) as unknown as { default: SharpModule };
  _sharpCtor = mod.default;
  return _sharpCtor;
}

const THUMB_WIDTH = 512;
const WATERMARK_OPACITY = 0.45;
const WATERMARK_TEXT = 'AIStudio';

export interface ProcessOptions {
  /** When true, embed the AIStudio watermark in the corner. */
  watermark?: boolean;
  /** Final master JPEG quality. */
  quality?: number;
}

export interface ProcessedImage {
  master: Buffer;
  thumbnail: Buffer;
  width: number;
  height: number;
}

/**
 * Process a raw model output buffer:
 * 1. Decode + (optionally) overlay watermark on the master.
 * 2. Render the master to a quality-tuned JPEG.
 * 3. Generate a square-aware thumbnail at THUMB_WIDTH.
 */
export async function processGeneratedImage(
  input: Buffer,
  opts: ProcessOptions = {}
): Promise<ProcessedImage> {
  const sharp = await loadSharp();
  const quality = opts.quality ?? 88;

  const baseImage = sharp(input, { failOn: 'truncated' });
  const metadata = await baseImage.metadata();
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;

  if (!width || !height) throw new Error('input image has no dimensions');

  let master: SharpInstance = sharp(input);

  if (opts.watermark) {
    const watermark = await buildWatermark(width, height);
    master = master.composite([
      {
        input: watermark,
        gravity: 'southeast',
      },
    ]);
  }

  const masterBuffer = await master.jpeg({ quality, progressive: true }).toBuffer();

  const thumbnailBuffer = await sharp(masterBuffer)
    .resize({ width: THUMB_WIDTH, withoutEnlargement: true })
    .jpeg({ quality: 80, progressive: true })
    .toBuffer();

  return {
    master: masterBuffer,
    thumbnail: thumbnailBuffer,
    width,
    height,
  };
}

async function buildWatermark(masterW: number, masterH: number): Promise<Buffer> {
  const sharp = await loadSharp();
  // Scale watermark height relative to the master so it stays readable
  // on both small thumbs and 1200x1600 portraits.
  const wmHeight = Math.max(24, Math.round(masterH * 0.045));
  const fontSize = Math.round(wmHeight * 0.55);
  const wmWidth = Math.min(masterW, Math.round(masterW * 0.32));

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${wmWidth}" height="${wmHeight}">
      <style>
        .wm {
          fill: white;
          font: 600 ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          paint-order: stroke;
          stroke: rgba(0,0,0,0.6);
          stroke-width: 2;
        }
      </style>
      <text x="${wmWidth - 12}" y="${wmHeight - 8}" class="wm" text-anchor="end">
        ${WATERMARK_TEXT}
      </text>
    </svg>
  `;
  return sharp(Buffer.from(svg))
    .png()
    .composite([])
    .modulate({})
    .ensureAlpha(WATERMARK_OPACITY)
    .toBuffer();
}
