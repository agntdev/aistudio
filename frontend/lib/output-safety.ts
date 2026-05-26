/**
 * Output NSFW safety check that runs server-side on a raw image buffer (T04).
 *
 * The T06 in-browser version uses an HTMLImageElement; this variant
 * decodes via `sharp` and feeds raw pixel data to `nsfwjs` so the same
 * model file works in the worker process. If anything in the pipeline
 * isn't available (no GPU, no model), we fail closed and report unsafe
 * — generation output not being inspectable is a worse outcome than a
 * false-positive block.
 */

import * as nsfwjs from 'nsfwjs';
import * as tf from '@tensorflow/tfjs';

let _model: nsfwjs.NSFWJS | null = null;
async function loadModel(): Promise<nsfwjs.NSFWJS> {
  if (_model) return _model;
  _model = await nsfwjs.load();
  return _model;
}

const NSFW_CLASSES = new Set(['Hentai', 'Porn', 'Sexy']);
const NSFW_THRESHOLD = 0.65;

export interface OutputSafetyResult {
  isNSFW: boolean;
  reasons: string[];
  predictions?: Array<{ className: string; probability: number }>;
}

export async function checkGeneratedImageSafetyFromBuffer(
  input: Buffer
): Promise<OutputSafetyResult> {
  try {
    const { default: sharp } = await import('sharp');
    const { data, info } = await sharp(input)
      .resize({ width: 224, height: 224, fit: 'cover' })
      .raw()
      .toBuffer({ resolveWithObject: true });

    const channels = info.channels;
    // nsfwjs expects a 3-channel tensor in [0, 255] range.
    const rgb = channels === 4 ? stripAlpha(data, info.width, info.height) : data;
    const tensor = tf.tensor3d(
      new Uint8Array(rgb),
      [info.height, info.width, 3],
      'int32'
    );

    const model = await loadModel();
    const predictions = await model.classify(tensor as tf.Tensor3D);
    tensor.dispose();

    const nsfwPred = predictions.find((p) => NSFW_CLASSES.has(p.className));
    const isNSFW = !!nsfwPred && nsfwPred.probability > NSFW_THRESHOLD;
    return {
      isNSFW,
      reasons:
        isNSFW && nsfwPred
          ? [`${nsfwPred.className} ${(nsfwPred.probability * 100).toFixed(0)}%`]
          : [],
      predictions: predictions.map((p) => ({
        className: p.className,
        probability: p.probability,
      })),
    };
  } catch (err) {
    // Fail closed — we'd rather block a generation than let an
    // unscanned image through to a user.
    return {
      isNSFW: true,
      reasons: [
        `output safety check unavailable: ${err instanceof Error ? err.message : String(err)}`,
      ],
    };
  }
}

function stripAlpha(buf: Buffer, width: number, height: number): Buffer {
  const out = Buffer.alloc(width * height * 3);
  for (let i = 0, j = 0; i < buf.length; i += 4, j += 3) {
    out[j] = buf[i];
    out[j + 1] = buf[i + 1];
    out[j + 2] = buf[i + 2];
  }
  return out;
}
