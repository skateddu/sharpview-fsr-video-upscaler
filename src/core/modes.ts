// Upscaling modes. No dependencies, so node --test can import it too.

/** anime4k: the Anime4K pipeline (several passes, see anime4k.ts), then bilinear to the output. */
export type UpscalePass = 'easu' | 'bicubic' | 'bilinear' | 'anime4k';

/** Passes of each mode: upscaling, then optional RCAS at 1:1. The key order is the playground's. */
export const MODE_PASSES = {
  fsr: { upscale: 'easu', rcas: true },
  easu: { upscale: 'easu', rcas: false },
  'bicubic-rcas': { upscale: 'bicubic', rcas: true },
  bicubic: { upscale: 'bicubic', rcas: false },
  'bilinear-rcas': { upscale: 'bilinear', rcas: true },
  bilinear: { upscale: 'bilinear', rcas: false },
  anime4k: { upscale: 'anime4k', rcas: false },
} as const satisfies Record<string, { upscale: UpscalePass; rcas: boolean }>;

export type UpscaleMode = keyof typeof MODE_PASSES;

export const UPSCALE_MODES = Object.keys(MODE_PASSES) as readonly UpscaleMode[];

/**
 * Rendering qualities, from the heaviest to the lightest: anime = Anime4K, high = FSR1 (EASU +
 * RCAS), light = bicubic + RCAS, minimal = bilinear + RCAS. The user chooses between anime, high
 * and light; minimal is the last step before the native video on a GPU that cannot keep up, and
 * the pipeline for sharpening at native size. The modes without RCAS are for the playground and
 * the tests.
 */
const LADDER = ['anime', 'high', 'light', 'minimal'] as const;

export type Quality = (typeof LADDER)[number];

/** Qualities offered to the user. */
export const QUALITIES = ['high', 'light', 'anime'] as const satisfies readonly Quality[];

/** A quality the user can choose (and the one stored in the settings). */
export type ChosenQuality = (typeof QUALITIES)[number];

const QUALITY_MODES: Record<Quality, UpscaleMode> = {
  anime: 'anime4k',
  high: 'fsr',
  light: 'bicubic-rcas',
  minimal: 'bilinear-rcas',
};

export function qualityMode(quality: Quality): UpscaleMode {
  return QUALITY_MODES[quality];
}

/** Next lighter quality when the GPU cannot keep up; null when only the native video is left. */
export function lowerQuality(quality: Quality): Quality | null {
  return LADDER[LADDER.indexOf(quality) + 1] ?? null;
}

/** RCAS sharpening in percent: AMD's default of 0.2 stops is exp2(-0.2) ≈ 87%. */
export const DEFAULT_SHARPNESS = 87;
