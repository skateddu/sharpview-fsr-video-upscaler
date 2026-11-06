// Anime4K v4 (https://github.com/bloc97/Anime4K, MIT): the shaders in shaders/anime4k are the
// original files, unchanged, run by HookPipeline as mpv would.
import clampHighlights from './shaders/anime4k/Anime4K_Clamp_Highlights.glsl';
import restoreSoftM from './shaders/anime4k/Anime4K_Restore_CNN_Soft_M.glsl';
import upscaleM from './shaders/anime4k/Anime4K_Upscale_CNN_x2_M.glsl';
import downscaleX4 from './shaders/anime4k/Anime4K_AutoDownscalePre_x4.glsl';
import upscaleS from './shaders/anime4k/Anime4K_Upscale_CNN_x2_S.glsl';

/**
 * Mode B (Fast) of the official mpv presets: a soft restore (compression artifacts, blur), ×2, and
 * above ×2.4 a second, lighter ×2 from half the output size. Each pass decides with its WHEN
 * condition whether it runs: below ×1.2 only the restore pass does. AutoDownscalePre_x2 is
 * left out: it scales to the output with bilinear filtering, which the final pass does anyway.
 * The PREKERNEL clamp of Clamp_Highlights is applied by the final pass (anime4k-out.frag.glsl).
 * The soft restore of Mode B beats Mode A's on real anime frames, compressed or clean (+0.04 to
 * +2.1 dB PSNR); Mode A's flattens fine texture on clean sources.
 */
export const ANIME4K_MODE_B = [clampHighlights, restoreSoftM, upscaleM, downscaleX4, upscaleS] as const;
