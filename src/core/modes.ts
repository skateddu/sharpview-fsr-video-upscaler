// Upscaling modes. No dependencies, so node --test can import it too.

export type UpscaleMode = 'fsr' | 'easu' | 'bilinear-rcas' | 'bilinear';

export const UPSCALE_MODES: readonly UpscaleMode[] = ['fsr', 'easu', 'bilinear-rcas', 'bilinear'];

/**
 * Quality offered to the user: high = FSR1 (EASU + RCAS), light = bilinear + RCAS. The four
 * modes remain for the playground and tests: "EASU only" is high with zero sharpening, and
 * "bilinear" is what the browser already does.
 */
export type Quality = 'high' | 'light';

export const QUALITIES: readonly Quality[] = ['high', 'light'];

export function qualityMode(quality: Quality): UpscaleMode {
  return quality === 'high' ? 'fsr' : 'bilinear-rcas';
}

/** RCAS sharpening in percent: AMD's default of 0.2 stops is exp2(-0.2) ≈ 87%. */
export const DEFAULT_SHARPNESS = 87;
