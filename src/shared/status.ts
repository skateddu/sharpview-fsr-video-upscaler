// State of a video handled by the extension: typed codes and a single table mapping them to
// localized messages, used by the label on the video, the popup and the logs. Pure logic
// (tested with node --test).
import type { Quality } from '../core/modes.ts';

/** How a status's detail is shown: as the message's placeholder, or appended in parentheses. */
type DetailUse = 'none' | 'substitution' | 'suffix';

const MESSAGES = {
  active: { key: 'statusActive', detail: 'none' },
  /** Waiting for IntersectionObserver's first answer. */
  waiting: { key: 'statusWaiting', detail: 'none' },
  /** Element detached from the page (within the grace period before closing). */
  removed: { key: 'statusRemoved', detail: 'none' },
  offscreen: { key: 'statusOffscreen', detail: 'none' },
  'no-frame': { key: 'statusNoFrame', detail: 'none' },
  hidden: { key: 'statusHidden', detail: 'none' },
  'too-small': { key: 'statusTooSmall', detail: 'none' },
  transform: { key: 'statusTransform', detail: 'none' },
  'fullscreen-video': { key: 'statusFullscreenVideo', detail: 'none' },
  /** Scale below the threshold: detail = scale with two decimals. */
  'not-needed': { key: 'statusNotNeeded', detail: 'substitution' },
  budget: { key: 'statusBudget', detail: 'none' },
  'context-lost': { key: 'statusContextLost', detail: 'none' },
  /** The GPU could not keep up even with the lightest quality. */
  'gpu-slow': { key: 'statusGpuSlow', detail: 'none' },
  // Permanent failures for the current source:
  drm: { key: 'statusDrm', detail: 'none' },
  'cross-origin': { key: 'statusCrossOrigin', detail: 'none' },
  /** WebGL2 missing or shaders not compiling: detail = error. */
  'webgl-error': { key: 'statusWebglError', detail: 'suffix' },
  /** Any other error while rendering: detail = error. */
  'render-error': { key: 'statusRenderError', detail: 'suffix' },
} as const satisfies Record<string, { key: string; detail: DetailUse }>;

export type StatusCode = keyof typeof MESSAGES;

export const STATUS_CODES = Object.keys(MESSAGES) as StatusCode[];

/** Codes that stay until the video changes source. */
export const PERMANENT_CODES: ReadonlySet<StatusCode> = new Set(['drm', 'cross-origin', 'webgl-error', 'render-error']);

export interface Status {
  code: StatusCode;
  detail?: string;
}

/** State of a video, as seen by the popup, tests and diagnostics. */
export interface VideoStatus extends Status {
  /** id of the <video> element. */
  id: string;
  /** Session number: changes only when the session is recreated. */
  session: number;
  /** Real-size video (not a preview, tracker or hidden element). */
  relevant: boolean;
  active: boolean;
  /** Effective quality (lighter than the chosen one when the GPU cannot keep up). */
  quality: Quality;
  degraded: boolean;
  fps: number;
  videoFps: number;
  input: string;
  output: string;
  canvasRect: { x: number; y: number; width: number; height: number } | null;
  frames: number;
}

export interface StatusMessage {
  /** Key in extension/_locales/{lang}/messages.json. */
  key: string;
  substitutions?: string[];
  /** Technical detail appended in parentheses (error messages, not translated). */
  detail?: string;
}

/** Localized message for a status (see describeStatus in the UI). */
export function statusMessage({ code, detail }: Status): StatusMessage {
  const { key, detail: use } = MESSAGES[code];
  if (use === 'substitution') return { key, substitutions: [detail ?? '?'] };
  if (use === 'suffix') return { key, detail };
  return { key };
}

/** Text for the user, given a translation function (t from i18n.ts). */
export function describeStatus(status: Status, t: (key: string, subs?: string[]) => string): string {
  const m = statusMessage(status);
  const text = t(m.key, m.substitutions);
  return m.detail ? `${text} (${m.detail})` : text;
}
