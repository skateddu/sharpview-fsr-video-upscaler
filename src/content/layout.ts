// Upscaling eligibility and geometry for a <video>, from measurements already read from the
// DOM. Pure logic (tested with node --test).
import { clipInsets, contentRect, type Rect } from '../core/geometry.ts';
import type { Status } from '../shared/status.ts';

/** Videos smaller than this (CSS px) are previews, ads or trackers: ignored. */
export const MIN_BOX = 128;

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
  objectFit: string;
  objectPosition: string;
  devicePixelRatio: number;
  minScale: number;
}

export interface Layout {
  /** Content rectangle relative to the video's box, in CSS px (may extend beyond the box). */
  content: Rect;
  /** Insets to clip (top, right, bottom, left) so that it stays inside the box. */
  clip: [number, number, number, number];
  /** Magnification in physical pixels relative to the source. */
  scale: number;
  /** Output resolution in physical pixels (before GPU limits). */
  outWidth: number;
  outHeight: number;
}

export type LayoutResult = { ok: true; layout: Layout } | { ok: false; status: Status };

export function evaluateLayout(i: LayoutInput): LayoutResult {
  const no = (code: Status['code'], detail?: string): LayoutResult => ({ ok: false, status: { code, detail } });
  if (i.display === 'none' || i.visibility === 'hidden') return no('hidden');
  if (!isTranslationOnly(i.transform)) return no('transform');
  if (i.boxWidth < MIN_BOX || i.boxHeight < MIN_BOX) return no('too-small');

  const content = contentRect(i.objectFit, i.videoWidth, i.videoHeight, i.boxWidth, i.boxHeight, i.objectPosition);
  const dpr = i.devicePixelRatio;
  const scale = Math.min((content.width * dpr) / i.videoWidth, (content.height * dpr) / i.videoHeight);
  if (scale < i.minScale) return no('not-needed', scale.toFixed(2));

  return {
    ok: true,
    layout: {
      content,
      clip: clipInsets(content, i.boxWidth, i.boxHeight),
      scale,
      outWidth: Math.round(content.width * dpr),
      outHeight: Math.round(content.height * dpr),
    },
  };
}

/** true for "none" or for a translation-only matrix (e.g. translate(-50%, -50%)). */
export function isTranslationOnly(transform: string): boolean {
  if (transform === 'none' || !transform) return true;
  const m = /^matrix\(([^)]+)\)$/.exec(transform);
  if (!m) return false; // matrix3d or anything else
  const [a, b, c, d] = m[1].split(',').map(Number);
  const near = (x: number, y: number) => Math.abs(x - y) < 1e-6;
  return near(a, 1) && near(b, 0) && near(c, 0) && near(d, 1);
}
