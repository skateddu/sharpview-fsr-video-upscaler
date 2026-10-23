// Upscaling modes. No dependencies, so node --test can import it too.

export type UpscalePass = 'easu' | 'bicubic' | 'bilinear';

/** Passes of each mode: upscaling, then optional RCAS at 1:1. The key order is the playground's. */
export const MODE_PASSES = {
  fsr: { upscale: 'easu', rcas: true },
  easu: { upscale: 'easu', rcas: false },
  'bicubic-rcas': { upscale: 'bicubic', rcas: true },
  bicubic: { upscale: 'bicubic', rcas: false },
  'bilinear-rcas': { upscale: 'bilinear', rcas: true },
  bilinear: { upscale: 'bilinear', rcas: false },
} as const satisfies Record<string, { upscale: UpscalePass; rcas: boolean }>;

export type UpscaleMode = keyof typeof MODE_PASSES;

export const UPSCALE_MODES = Object.keys(MODE_PASSES) as readonly UpscaleMode[];

/**
 * Rendering qualities, from the heaviest to the lightest: high = FSR1 (EASU + RCAS), light =
 * bicubic + RCAS, minimal = bilinear + RCAS. The user chooses between high and light; minimal is
 * the last step before the native video on a GPU that cannot keep up, and the pipeline for
 * sharpening at native size. The modes without RCAS are for the playground and the tests.
 */
const LADDER = ['high', 'light', 'minimal'] as const;

export type Quality = (typeof LADDER)[number];

/** Qualities offered to the user. */
export const QUALITIES = ['high', 'light'] as const satisfies readonly Quality[];

/** A quality the user can choose (and the one stored in the settings). */
export type ChosenQuality = (typeof QUALITIES)[number];

const QUALITY_MODES: Record<Quality, UpscaleMode> = {
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
