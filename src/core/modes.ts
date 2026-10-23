// Upscaling modes. No dependencies, so node --test can import it too.

export type UpscaleMode = 'fsr' | 'easu' | 'bicubic-rcas' | 'bicubic' | 'bilinear-rcas' | 'bilinear';

export const UPSCALE_MODES: readonly UpscaleMode[] = [
  'fsr',
  'easu',
  'bicubic-rcas',
  'bicubic',
  'bilinear-rcas',
  'bilinear',
];

/** Passes of each mode: upscaling, then optional RCAS at 1:1. */
export const MODE_PASSES: Record<UpscaleMode, { upscale: 'easu' | 'bicubic' | 'bilinear'; rcas: boolean }> = {
  fsr: { upscale: 'easu', rcas: true },
  easu: { upscale: 'easu', rcas: false },
  'bicubic-rcas': { upscale: 'bicubic', rcas: true },
  bicubic: { upscale: 'bicubic', rcas: false },
  'bilinear-rcas': { upscale: 'bilinear', rcas: true },
  bilinear: { upscale: 'bilinear', rcas: false },
};

/**
 * Rendering quality: high = FSR1 (EASU + RCAS), light = bicubic + RCAS, minimal = bilinear +
 * RCAS. The user chooses between high and light; minimal is the last step before the native
 * video on a GPU that cannot keep up, and the pipeline for sharpening at native size. The modes
 * without RCAS are for the playground and the tests.
 */
export type Quality = 'high' | 'light' | 'minimal';

/** Qualities offered to the user. */
export const QUALITIES: readonly Quality[] = ['high', 'light'];

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
  return quality === 'high' ? 'light' : quality === 'light' ? 'minimal' : null;
}

/** RCAS sharpening in percent: AMD's default of 0.2 stops is exp2(-0.2) ≈ 87%. */
export const DEFAULT_SHARPNESS = 87;
