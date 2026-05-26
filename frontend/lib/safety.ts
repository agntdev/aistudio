/**
 * Safety & Moderation utilities for AIStudio (T06)
 *
 * This module centralizes:
 * - Prompt blocklist (prevents harmful/NSFW generation prompts)
 * - Client-side image safety helpers (resolution already done in T02, this adds hooks for NSFW/minor)
 * - Liveness verification types and helpers
 *
 * In production:
 * - Image NSFW + minor detection should be done server-side (Replicate, AWS Rekognition, or dedicated model)
 * - Liveness should use a robust service (e.g. face embedding comparison + motion)
 * - Prompt safety can be enforced both client + server
 */

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

/**
 * Checks a prompt against the blocklist.
 * Returns detailed result for UI feedback.
 */
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

/**
 * Basic client-side image safety interface.
 * In a real T06 implementation this would call a backend endpoint.
 */
export interface ImageSafetyResult {
  isNSFW: boolean;
  isMinor: boolean;
  confidence: number; // 0-1
  reasons: string[];
}

/**
 * Placeholder for server-side image moderation.
 * Replace this with real API call once backend safety endpoints exist.
 */
export async function checkImageSafety(file: File): Promise<ImageSafetyResult> {
  // TODO (T06): Call backend /api/moderation/image or Replicate NSFW model
  // For now we do a very lightweight client heuristic + always pass (demo mode)

  // Simple size-based heuristic (very rough)
  const isVerySmall = file.size < 50 * 1024; // under 50kb is suspicious for training photos

  if (isVerySmall) {
    return {
      isNSFW: false,
      isMinor: false,
      confidence: 0.6,
      reasons: ['Image file size unusually small — manual review recommended'],
    };
  }

  // Default: assume safe until real model is wired
  return {
    isNSFW: false,
    isMinor: false,
    confidence: 0.9,
    reasons: [],
  };
}

/**
 * Liveness verification result.
 */
export interface LivenessResult {
  verified: boolean;
  method: 'webcam' | 'none';
  timestamp: Date;
  metadata?: {
    durationSeconds?: number;
    framesAnalyzed?: number;
  };
}

/**
 * Simple liveness check using webcam.
 * In production this should be replaced with a proper liveness service
 * (face landmarks + challenge-response, or 3rd party like FaceTec / Veriff).
 */
export async function performLivenessCheck(
  durationSeconds: number = 5
): Promise<LivenessResult> {
  // This is a stub implementation.
  // A full version would:
  // 1. Request camera
  // 2. Record short video or analyze motion / blink / head turn
  // 3. Optionally send frames to backend for embedding comparison

  return new Promise((resolve) => {
    // Simulate processing time
    setTimeout(() => {
      resolve({
        verified: true,
        method: 'webcam',
        timestamp: new Date(),
        metadata: {
          durationSeconds,
          framesAnalyzed: Math.floor(durationSeconds * 8),
        },
      });
    }, 1200);
  });
}

export const SAFETY_CONFIG = {
  minLivenessDurationSeconds: 4,
  promptBlocklistSize: BLOCKED_PROMPT_KEYWORDS.length,
} as const;
