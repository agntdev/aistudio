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
// Liveness verification — real frame-by-frame motion analysis
// ---------------------------------------------------------------------------

export interface LivenessResult {
  verified: boolean;
  method: 'webcam' | 'none';
  timestamp: Date;
  metadata?: {
    durationSeconds?: number;
    framesAnalyzed?: number;
    averageMotion?: number;
    motionPeak?: number;
    rejectionReason?: string;
  };
}

export interface LivenessConfig {
  durationSeconds: number;
  fps: number;
  minAverageMotion: number;
  minPeakMotion: number;
}

export const DEFAULT_LIVENESS_CONFIG: LivenessConfig = {
  durationSeconds: 5,
  fps: 6,
  minAverageMotion: 1.5,
  minPeakMotion: 4.0,
};

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
 * Real liveness check: captures frames from the provided <video> at `fps`
 * for `durationSeconds`, measures inter-frame motion, and requires both
 * sustained average motion and at least one peak (e.g. a head turn / blink).
 * A still photo held in front of the camera produces ~zero motion and fails.
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

  const totalFrames = Math.max(2, Math.round(cfg.durationSeconds * cfg.fps));
  const intervalMs = (cfg.durationSeconds * 1000) / totalFrames;

  const deltas: number[] = [];
  let prev: Uint8ClampedArray | null = null;

  for (let i = 0; i < totalFrames; i++) {
    if (videoEl.readyState >= 2) {
      ctx.drawImage(videoEl, 0, 0, W, H);
      const cur = ctx.getImageData(0, 0, W, H).data;
      if (prev) {
        deltas.push(frameDelta(prev, cur));
      }
      prev = cur;
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
  const verified = avg >= cfg.minAverageMotion && peak >= cfg.minPeakMotion;

  return {
    verified,
    method: 'webcam',
    timestamp: new Date(),
    metadata: {
      durationSeconds: cfg.durationSeconds,
      framesAnalyzed: deltas.length + 1,
      averageMotion: Number(avg.toFixed(2)),
      motionPeak: Number(peak.toFixed(2)),
      rejectionReason: verified
        ? undefined
        : avg < cfg.minAverageMotion
        ? 'insufficient-average-motion'
        : 'insufficient-peak-motion',
    },
  };
}

/**
 * Convenience wrapper for callers that don't have a video element handy.
 * Kept for backwards compatibility — but prefer the real check above when
 * a <video> is available.
 */
export async function performLivenessCheck(
  durationSeconds: number = 5
): Promise<LivenessResult> {
  return {
    verified: false,
    method: 'none',
    timestamp: new Date(),
    metadata: {
      durationSeconds,
      framesAnalyzed: 0,
      rejectionReason: 'no-video-element-provided',
    },
  };
}

export const SAFETY_CONFIG = {
  minLivenessDurationSeconds: DEFAULT_LIVENESS_CONFIG.durationSeconds,
  promptBlocklistSize: BLOCKED_PROMPT_KEYWORDS.length,
  nsfwThreshold: NSFW_THRESHOLD,
} as const;
