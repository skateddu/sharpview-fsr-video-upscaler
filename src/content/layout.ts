// Upscaling eligibility and geometry of a <video>. Pure logic, tested with node --test.
import { clipInsets, contentRect, type Rect } from '../core/geometry.ts';
import type { Status } from '../shared/status.ts';

/** Videos smaller than this (CSS px) are previews, ads or trackers: ignored. */
export const MIN_BOX = 128;

/**
 * Lowest scale for sharpening only: a video shown at its resolution, allowing for rounding.
 * Smaller videos stay native, as bilinear without mipmaps would downscale worse than Firefox.
 */
export const MIN_SHARPEN_SCALE = 0.98;

export interface LayoutInput {
  videoWidth: number;
  videoHeight: number;
  /** clientWidth/clientHeight of the <video>: content box, without borders. */
  boxWidth: number;
  boxHeight: number;
  /** Computed values (getComputedStyle). */
  display: string;
  visibility: string;
  transform: string;
  /** Individual transform properties, e.g. "1.33 1.33" and "none" (zoom-to-fill extensions). */
  scale: string;
  rotate: string;
  objectFit: string;
  objectPosition: string;
  devicePixelRatio: number;
  minScale: number;
  /** Below minScale, sharpening only instead of the original video (and sharpness > 0). */
  sharpenNative: boolean;
}

export interface Layout {
  /** Content rectangle relative to the video's box, in CSS px (may extend beyond the box). */
  content: Rect;
  /** Insets to clip (top, right, bottom, left) so that it stays inside the box. */
  clip: [number, number, number, number];
  /** Magnification in physical pixels relative to the source. */
  scale: number;
  /** Below the threshold: sharpening only, without upscaling. */
  sharpenOnly: boolean;
  /** Output resolution in physical pixels (before GPU limits). */
  outWidth: number;
  outHeight: number;
}

export type LayoutResult = { ok: true; layout: Layout } | { ok: false; status: Status };

export function evaluateLayout(i: LayoutInput): LayoutResult {
  const no = (code: Status['code'], detail?: string): LayoutResult => ({ ok: false, status: { code, detail } });
  if (i.display === 'none' || i.visibility === 'hidden') return no('hidden');
  const zoom = ownScale(i.transform, i.scale, i.rotate);
  if (!zoom) return no('transform');
  if (i.boxWidth < MIN_BOX || i.boxHeight < MIN_BOX) return no('too-small');

  // The video's own scale enlarges its box and content alike; the canvas is not scaled, so it
  // takes the enlarged size (where it sits on screen is measured by the overlay).
  const [sx, sy] = zoom;
  const c = contentRect(i.objectFit, i.videoWidth, i.videoHeight, i.boxWidth, i.boxHeight, i.objectPosition);
  const content = { x: c.x * sx, y: c.y * sy, width: c.width * sx, height: c.height * sy };
  const dpr = i.devicePixelRatio;
  const scale = Math.min((content.width * dpr) / i.videoWidth, (content.height * dpr) / i.videoHeight);
  const sharpenOnly = scale < i.minScale;
  if (sharpenOnly && !(i.sharpenNative && scale >= MIN_SHARPEN_SCALE)) return no('not-needed', scale.toFixed(2));

  return {
    ok: true,
    layout: {
      content,
      clip: clipInsets(content, i.boxWidth * sx, i.boxHeight * sy),
      scale,
      sharpenOnly,
      outWidth: Math.round(content.width * dpr),
      outHeight: Math.round(content.height * dpr),
    },
  };
}

/**
 * Horizontal and vertical scale of the video from its computed `transform`, `scale` and `rotate`
 * (translations are measured on screen by the overlay). null for anything the canvas cannot
 * follow: rotation, skew, mirroring, 3D.
 */
export function ownScale(transform: string, scale: string, rotate: string): [number, number] | null {
  if (rotate && rotate !== 'none') return null;
  let sx = 1;
  let sy = 1;
  if (transform && transform !== 'none') {
    const m = /^matrix\(([^)]+)\)$/.exec(transform);
    if (!m) return null; // matrix3d or anything else
    const [a, b, c, d] = m[1].split(',').map(Number);
    if (Math.abs(b) > 1e-6 || Math.abs(c) > 1e-6) return null;
    sx = a;
    sy = d;
  }
  if (scale && scale !== 'none') {
    const parts = scale.trim().split(/\s+/).map((v) => (v.endsWith('%') ? parseFloat(v) / 100 : Number(v)));
    if (parts.length > 2 && parts[2] !== 1) return null;
    sx *= parts[0];
    sy *= parts[1] ?? parts[0];
  }
  return sx > 0 && sy > 0 ? [sx, sy] : null;
}
