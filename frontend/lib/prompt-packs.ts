/**
 * Prompt packs (T04).
 *
 * A "pack" is a named bundle of prompt templates with a curated style
 * and consistent negative-prompt + parameter defaults. The frontend
 * shows the packs as cards; on selection we expand each template by
 * substituting `{trigger_word}` (and any other vars) for the user's
 * trained LoRA trigger, then enqueue one generation per template.
 *
 * Keep packs in code so they're auditable and version-controlled rather
 * than living in untyped DB rows.
 */

export interface PromptTemplate {
  /** Display name, e.g. "Golden hour close-up". */
  name: string;
  /** Template with {trigger_word} (and optionally {style}) tokens. */
  template: string;
  /** Negative-prompt additions, ANDed with the pack's default. */
  negativePromptExtras?: string;
}

export interface PromptPack {
  id: string;
  name: string;
  description: string;
  thumbnail?: string;
  /** Default negative prompt applied to every template in the pack. */
  defaultNegativePrompt: string;
  /** Default inference parameters. The route can override per-call. */
  defaults: {
    width: number;
    height: number;
    steps: number;
    guidanceScale: number;
  };
  templates: PromptTemplate[];
}

const BASE_NEGATIVE =
  'low quality, blurry, deformed, distorted, watermark, signature, text, extra limbs, extra fingers, bad anatomy';

export const PROMPT_PACKS: PromptPack[] = [
  {
    id: 'studio-portrait',
    name: 'Studio Portrait',
    description:
      'Editorial-grade headshots with controlled lighting and clean backdrops.',
    defaultNegativePrompt: BASE_NEGATIVE,
    defaults: { width: 832, height: 1216, steps: 28, guidanceScale: 3.5 },
    templates: [
      {
        name: 'Beauty light',
        template:
          'portrait photograph of {trigger_word}, beauty lighting, soft key + reflector, neutral gray background, sharp focus, 85mm lens, shot on Hasselblad',
      },
      {
        name: 'Rembrandt',
        template:
          'portrait of {trigger_word}, classical Rembrandt lighting, dark background, subtle film grain, art-directed pose',
      },
      {
        name: 'Black and white',
        template:
          'black and white editorial portrait of {trigger_word}, contrasty studio lighting, silver halide tones, fashion magazine style',
      },
    ],
  },
  {
    id: 'cinematic',
    name: 'Cinematic',
    description:
      'Wide-format scenes with film-stock colour grades and dramatic atmosphere.',
    defaultNegativePrompt: BASE_NEGATIVE + ', cgi, cartoon',
    defaults: { width: 1216, height: 832, steps: 30, guidanceScale: 4 },
    templates: [
      {
        name: 'Night street',
        template:
          'cinematic still of {trigger_word} on a rain-slick neon-lit city street at night, anamorphic lens flare, Roger Deakins style, shallow depth of field',
      },
      {
        name: 'Golden hour',
        template:
          'cinematic still of {trigger_word} backlit by golden hour sun, hazy bokeh, warm Kodak Portra 400 grade, long lens',
      },
      {
        name: 'Brutalist concrete',
        template:
          'cinematic medium shot of {trigger_word} against a brutalist concrete wall, cool teal-orange grade, fashion editorial feel',
      },
    ],
  },
  {
    id: 'editorial-fashion',
    name: 'Editorial Fashion',
    description: 'High-end magazine fashion editorials with stylised wardrobe.',
    defaultNegativePrompt: BASE_NEGATIVE + ', amateur, snapshot',
    defaults: { width: 832, height: 1216, steps: 28, guidanceScale: 3.5 },
    templates: [
      {
        name: 'Vogue cover',
        template:
          'editorial cover photograph of {trigger_word}, full-page Vogue layout, designer outfit, dramatic posture, location shoot',
      },
      {
        name: 'Avant-garde',
        template:
          'avant-garde fashion editorial of {trigger_word}, conceptual styling, oversized silhouettes, studio with coloured gels',
      },
      {
        name: 'Streetwear',
        template:
          'streetwear lookbook photograph of {trigger_word}, contemporary urban setting, layered outfit, candid posture',
      },
    ],
  },
  {
    id: 'travel',
    name: 'Travel',
    description: 'Destination-style images placing the subject in iconic locations.',
    defaultNegativePrompt: BASE_NEGATIVE,
    defaults: { width: 1216, height: 832, steps: 28, guidanceScale: 3.5 },
    templates: [
      {
        name: 'Italian coast',
        template:
          'photograph of {trigger_word} on a sun-drenched Italian coastline, Amalfi cliffs in background, linen outfit, magazine travel feature style',
      },
      {
        name: 'Tokyo night',
        template:
          'photograph of {trigger_word} in Shibuya at night, vibrant neon signs reflecting on wet pavement, candid posture, cinematic atmosphere',
      },
      {
        name: 'Alpine hike',
        template:
          'photograph of {trigger_word} on an Alpine mountain pass, technical hiking gear, dramatic clouds, golden afternoon light',
      },
    ],
  },
];

export interface ExpandedPrompt {
  packId: string;
  templateName: string;
  prompt: string;
  negativePrompt: string;
  defaults: PromptPack['defaults'];
}

/**
 * Expand every template in `packId` for the given trigger word.
 * Throws if the pack id is unknown so the caller learns about typos
 * rather than silently producing zero generations.
 */
export function expandPack(
  packId: string,
  triggerWord: string,
  extras: Record<string, string> = {}
): ExpandedPrompt[] {
  const pack = PROMPT_PACKS.find((p) => p.id === packId);
  if (!pack) throw new Error(`unknown prompt pack: ${packId}`);
  return pack.templates.map((t) => ({
    packId: pack.id,
    templateName: t.name,
    prompt: substitute(t.template, { trigger_word: triggerWord, ...extras }),
    negativePrompt: [pack.defaultNegativePrompt, t.negativePromptExtras]
      .filter(Boolean)
      .join(', '),
    defaults: pack.defaults,
  }));
}

function substitute(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{(\w+)\}/g, (_, key) => {
    const v = vars[key];
    if (v === undefined) {
      // Surface unknown placeholders in the output so it's obvious during
      // development rather than silently leaving `{foo}` in the prompt.
      return `[missing:${key}]`;
    }
    return v;
  });
}

export function listPromptPacks(): Array<Omit<PromptPack, 'templates'>> {
  return PROMPT_PACKS.map((p) => {
    const { templates: _templates, ...rest } = p;
    void _templates;
    return rest;
  });
}

export function getPromptPack(id: string): PromptPack | undefined {
  return PROMPT_PACKS.find((p) => p.id === id);
}
