/**
 * Safety & Moderation utilities for AIStudio (T06)
 *
 * Centralizes:
 * - Prompt blocklist (prevents harmful/NSFW generation prompts)
 * - Input image safety (real nsfwjs-based NSFW + minor heuristics)
 * - Output image safety (separate check applied to generated images)
 * - Liveness verification (real frame-by-frame motion analysis)
 */

import * as nsfwjs from 'nsfwjs';
import * as blazeface from '@tensorflow-models/blazeface';
import '@tensorflow/tfjs';

export const BLOCKED_PROMPT_KEYWORDS = [
  // NSFW / sexual
  'nude', 'naked', 'sex', 'porn', 'explicit', 'nsfw', 'lingerie', 'underwear',
  'bondage', 'bdsm', 'erotic', 'seductive', 'aroused',

  // Violence / illegal
  'violence', 'blood', 'gore', 'weapon', 'gun', 'knife', 'kill', 'murder',
  'terrorist', 'bomb', 'drugs', 'cocaine', 'heroin',

  // Minors / harmful
  'child', 'kid', 'teen', 'minor', 'underage', 'schoolgirl', 'schoolboy',

  // Hate / discriminatory
  'nazi', 'hitler', 'racist', 'slur',
] as const;

export interface PromptSafetyResult {
  safe: boolean;
  blockedTerms: string[];
  message?: string;
}

export function checkPromptSafety(prompt: string): PromptSafetyResult {
  if (!prompt || prompt.trim().length === 0) {
    return { safe: true, blockedTerms: [] };
  }

  const lower = prompt.toLowerCase();
  const blockedTerms: string[] = [];

  for (const term of BLOCKED_PROMPT_KEYWORDS) {
    if (lower.includes(term)) {
      blockedTerms.push(term);
    }
  }

  if (blockedTerms.length > 0) {
    return {
      safe: false,
      blockedTerms,
      message: `Prompt contains blocked terms: ${blockedTerms.join(', ')}. Please revise.`,
    };
  }

  return { safe: true, blockedTerms: [] };
}

// ---------------------------------------------------------------------------
// Image safety — real nsfwjs detection
// ---------------------------------------------------------------------------

export interface ImageSafetyResult {
  isNSFW: boolean;
  isMinor: boolean;
  confidence: number;
  reasons: string[];
  predictions?: Array<{ className: string; probability: number }>;
}

let _nsfwModel: nsfwjs.NSFWJS | null = null;

async function loadModel(): Promise<nsfwjs.NSFWJS> {
  if (_nsfwModel) return _nsfwModel;
  _nsfwModel = await nsfwjs.load();
  return _nsfwModel;
}

async function fileToImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(e);
    img.src = url;
  });
}

async function urlToImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(e);
    img.src = src;
  });
}

const NSFW_CLASSES = new Set(['Hentai', 'Porn', 'Sexy']);
const NSFW_THRESHOLD = 0.65;
// Heuristic: very low resolution or extreme small file size often indicates
// a non-photographic or scraped low-quality image — used as a weak signal
// alongside the model for minor flagging.
const SUSPICIOUS_BYTE_THRESHOLD = 30 * 1024;

/**
 * Checks an uploaded (input) image for NSFW content using nsfwjs.
 * Note: The "minor" signal is conservative — nsfwjs does not predict age
 * directly, so we surface a weak heuristic and leave authoritative minor
 * detection to a server-side service (documented gap).
 */
export async function checkImageSafety(file: File): Promise<ImageSafetyResult> {
  if (typeof window === 'undefined') {
    // No DOM (called server-side) — bail safely; real server moderation lives elsewhere.
    return { isNSFW: false, isMinor: false, confidence: 0, reasons: ['skipped: no DOM'] };
  }
  try {
    const model = await loadModel();
    const img = await fileToImage(file);
    const predictions = await model.classify(img);
    URL.revokeObjectURL(img.src);

    const reasons: string[] = [];
    const nsfwPred = predictions.find((p) => NSFW_CLASSES.has(p.className));
    const isNSFW = !!nsfwPred && nsfwPred.probability > NSFW_THRESHOLD;
    if (isNSFW && nsfwPred) {
      reasons.push(`NSFW (${nsfwPred.className} ${(nsfwPred.probability * 100).toFixed(0)}%)`);
    }

    // Weak minor heuristic: tiny files paired with a high "Drawing" prob can
    // indicate stylised / cartoon content; not a substitute for an age model.
    const drawing = predictions.find((p) => p.className === 'Drawing');
    const looksCartoon = !!drawing && drawing.probability > 0.7;
    const isMinor = looksCartoon && file.size < SUSPICIOUS_BYTE_THRESHOLD;
    if (isMinor) {
      reasons.push('possible-minor: cartoon/stylised + small file — needs manual review');
    }

    const confidence = nsfwPred?.probability ?? 0.5;

    return {
      isNSFW,
      isMinor,
      confidence,
      reasons,
      predictions: predictions.map((p) => ({ className: p.className, probability: p.probability })),
    };
  } catch (err) {
    console.warn('checkImageSafety failed, defaulting to safe', err);
    return { isNSFW: false, isMinor: false, confidence: 0, reasons: ['detector unavailable'] };
  }
}

/**
 * Output-image NSFW filter — applied to images produced by the generator.
 * Distinct from the prompt blocklist: even safe-looking prompts can produce
 * unsafe pixels, so generated images must be re-screened before display.
 */
export async function checkGeneratedImageSafety(src: string): Promise<ImageSafetyResult> {
  if (typeof window === 'undefined') {
    return { isNSFW: false, isMinor: false, confidence: 0, reasons: ['skipped: no DOM'] };
  }
  try {
    const model = await loadModel();
    const img = await urlToImage(src);
    const predictions = await model.classify(img);
    const nsfwPred = predictions.find((p) => NSFW_CLASSES.has(p.className));
    const isNSFW = !!nsfwPred && nsfwPred.probability > NSFW_THRESHOLD;
    return {
      isNSFW,
      isMinor: false,
      confidence: nsfwPred?.probability ?? 0.5,
      reasons: isNSFW && nsfwPred
        ? [`Output blocked: ${nsfwPred.className} ${(nsfwPred.probability * 100).toFixed(0)}%`]
        : [],
      predictions: predictions.map((p) => ({ className: p.className, probability: p.probability })),
    };
  } catch (err) {
    console.warn('checkGeneratedImageSafety failed, defaulting to safe', err);
    return { isNSFW: false, isMinor: false, confidence: 0, reasons: ['detector unavailable'] };
  }
}

// ---------------------------------------------------------------------------
// Liveness verification — face detection (BlazeFace) + motion analysis
// ---------------------------------------------------------------------------

export interface LivenessResult {
  verified: boolean;
  method: 'webcam' | 'none';
  timestamp: Date;
  metadata?: {
    durationSeconds?: number;
    framesAnalyzed?: number;
    framesWithFace?: number;
    faceDetectionRate?: number;
    averageMotion?: number;
    motionPeak?: number;
    landmarkVariance?: number;
    faceSignature?: number[];
    rejectionReason?: string;
  };
}

export interface LivenessConfig {
  durationSeconds: number;
  fps: number;
  minAverageMotion: number;
  minPeakMotion: number;
  minFaceDetectionRate: number;
  minLandmarkVariance: number;
}

export const DEFAULT_LIVENESS_CONFIG: LivenessConfig = {
  durationSeconds: 5,
  fps: 6,
  minAverageMotion: 1.5,
  minPeakMotion: 4.0,
  minFaceDetectionRate: 0.6,
  minLandmarkVariance: 1.5,
};

let _blazefaceModel: blazeface.BlazeFaceModel | null = null;
async function loadBlazeFace(): Promise<blazeface.BlazeFaceModel> {
  if (_blazefaceModel) return _blazefaceModel;
  _blazefaceModel = await blazeface.load();
  return _blazefaceModel;
}

/**
 * Reduce BlazeFace landmarks to a small numeric "face signature" we can
 * compare frame-to-frame. Six landmarks * 2 coords (x, y) normalised by
 * the face bounding box size — gives an embedding-like vector that drifts
 * when the same person turns their head but is wildly different for
 * different faces or printed photos held at different angles.
 */
function normaliseLandmarks(
  prediction: blazeface.NormalizedFace
): number[] | null {
  const lm = prediction.landmarks as number[][] | undefined;
  const tl = prediction.topLeft as [number, number] | Float32Array;
  const br = prediction.bottomRight as [number, number] | Float32Array;
  if (!lm || !tl || !br) return null;
  const x0 = Number(tl[0]);
  const y0 = Number(tl[1]);
  const w = Math.max(1, Number(br[0]) - x0);
  const h = Math.max(1, Number(br[1]) - y0);
  const out: number[] = [];
  for (const [lx, ly] of lm) {
    out.push((lx - x0) / w, (ly - y0) / h);
  }
  return out;
}

function vectorVariance(samples: number[][]): number {
  if (samples.length < 2) return 0;
  const dims = samples[0].length;
  const means = new Array(dims).fill(0);
  for (const s of samples) for (let i = 0; i < dims; i++) means[i] += s[i];
  for (let i = 0; i < dims; i++) means[i] /= samples.length;
  let total = 0;
  for (const s of samples) {
    for (let i = 0; i < dims; i++) {
      total += (s[i] - means[i]) ** 2;
    }
  }
  // Scale up so the threshold can be a friendly small number.
  return (total / samples.length) * 1000;
}

/**
 * Compute mean absolute pixel-luma delta between two same-size frames.
 * Returns a value roughly in 0..255 — higher means more motion.
 */
function frameDelta(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  const n = Math.min(a.length, b.length);
  let sum = 0;
  let count = 0;
  // Sample every 16th pixel-RGBA quad (~step of 64 bytes) for performance.
  for (let i = 0; i < n; i += 64) {
    const lumaA = 0.299 * a[i] + 0.587 * a[i + 1] + 0.114 * a[i + 2];
    const lumaB = 0.299 * b[i] + 0.587 * b[i + 1] + 0.114 * b[i + 2];
    sum += Math.abs(lumaA - lumaB);
    count++;
  }
  return count === 0 ? 0 : sum / count;
}

/**
 * Real liveness check.
 *
 * Captures frames from the provided <video> at `fps` for `durationSeconds`
 * and combines three independent signals:
 *
 *   1. Inter-frame pixel motion (rejects a held photograph).
 *   2. BlazeFace face presence on every sampled frame
 *      (rejects "no person in view" or a fingertip).
 *   3. Face-landmark vector variance over time
 *      (a head turn / blink / smile moves the BlazeFace landmark embedding;
 *      a printed photo on a stick does not).
 *
 * The caller is responsible for getting a MediaStream and attaching it to
 * the <video> element; this function only reads frames.
 */
export async function performLivenessCheckOnVideo(
  videoEl: HTMLVideoElement,
  config: Partial<LivenessConfig> = {}
): Promise<LivenessResult> {
  const cfg: LivenessConfig = { ...DEFAULT_LIVENESS_CONFIG, ...config };

  const canvas = document.createElement('canvas');
  const W = 96;
  const H = 72;
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    return {
      verified: false,
      method: 'webcam',
      timestamp: new Date(),
      metadata: { rejectionReason: 'no-canvas-context' },
    };
  }

  let faceModel: blazeface.BlazeFaceModel | null = null;
  try {
    faceModel = await loadBlazeFace();
  } catch (err) {
    console.warn('blazeface unavailable, falling back to motion-only', err);
  }

  const totalFrames = Math.max(2, Math.round(cfg.durationSeconds * cfg.fps));
  const intervalMs = (cfg.durationSeconds * 1000) / totalFrames;

  const deltas: number[] = [];
  const faceVectors: number[][] = [];
  let framesWithFace = 0;
  let prev: Uint8ClampedArray | null = null;

  for (let i = 0; i < totalFrames; i++) {
    if (videoEl.readyState >= 2) {
      ctx.drawImage(videoEl, 0, 0, W, H);
      const cur = ctx.getImageData(0, 0, W, H).data;
      if (prev) deltas.push(frameDelta(prev, cur));
      prev = cur;

      if (faceModel) {
        try {
          const preds = await faceModel.estimateFaces(videoEl, false);
          if (preds.length > 0) {
            framesWithFace++;
            const vec = normaliseLandmarks(preds[0]);
            if (vec) faceVectors.push(vec);
          }
        } catch (err) {
          // swallow per-frame face detection errors so a transient TF op
          // failure doesn't kill the whole liveness pass.
          console.debug('face detection frame failed', err);
        }
      }
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }

  if (deltas.length === 0) {
    return {
      verified: false,
      method: 'webcam',
      timestamp: new Date(),
      metadata: { rejectionReason: 'no-frames-captured', framesAnalyzed: 0 },
    };
  }

  const avg = deltas.reduce((s, d) => s + d, 0) / deltas.length;
  const peak = deltas.reduce((m, d) => (d > m ? d : m), 0);
  const framesAnalyzed = deltas.length + 1;
  const faceRate = faceModel ? framesWithFace / framesAnalyzed : 1;
  const landmarkVariance = vectorVariance(faceVectors);
  const faceSignature =
    faceVectors.length > 0 ? faceVectors[faceVectors.length - 1] : undefined;

  let rejectionReason: string | undefined;
  if (avg < cfg.minAverageMotion) rejectionReason = 'insufficient-average-motion';
  else if (peak < cfg.minPeakMotion) rejectionReason = 'insufficient-peak-motion';
  else if (faceModel && faceRate < cfg.minFaceDetectionRate)
    rejectionReason = 'face-not-consistently-detected';
  else if (faceModel && landmarkVariance < cfg.minLandmarkVariance)
    rejectionReason = 'face-too-static-likely-photo';

  const verified = !rejectionReason;

  return {
    verified,
    method: 'webcam',
    timestamp: new Date(),
    metadata: {
      durationSeconds: cfg.durationSeconds,
      framesAnalyzed,
      framesWithFace,
      faceDetectionRate: Number(faceRate.toFixed(2)),
      averageMotion: Number(avg.toFixed(2)),
      motionPeak: Number(peak.toFixed(2)),
      landmarkVariance: Number(landmarkVariance.toFixed(2)),
      faceSignature,
      rejectionReason,
    },
  };
}

export const SAFETY_CONFIG = {
  minLivenessDurationSeconds: DEFAULT_LIVENESS_CONFIG.durationSeconds,
  promptBlocklistSize: BLOCKED_PROMPT_KEYWORDS.length,
  nsfwThreshold: NSFW_THRESHOLD,
} as const;
