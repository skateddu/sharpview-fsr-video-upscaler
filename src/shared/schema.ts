// Settings schema and per-site rules. Pure logic, no extension APIs: tested with node --test
// (hence the .ts extensions in imports).
import { DEFAULT_SHARPNESS, QUALITIES, type Quality } from '../core/modes.ts';

/**
 * v1: `mode` (4 algorithms) and `sharpness` in stops of attenuation.
 * v2: `quality` (high = FSR1, light = bilinear + RCAS) and `sharpness` as a linear % (0 = off).
 */
export const SETTINGS_VERSION = 2;

/** all: active everywhere except excluded sites · allowlist: only on allowed sites. */
export type SiteMode = 'all' | 'allowlist';

export interface Settings {
  version: number;
  /** Master switch. */
  enabled: boolean;
  quality: Quality;
  /** RCAS sharpening in %: 100 = maximum, 0 = off. */
  sharpness: number;
  denoise: boolean;
  /** Label with resolution and fps on top of the video. */
  showInfo: boolean;
  /** A/B comparison: left half with plain bilinear. */
  compare: boolean;
  /** Minimum scale factor to activate upscaling. */
  minScale: number;
  siteMode: SiteMode;
  blockedSites: string[];
  allowedSites: string[];
}

export const DEFAULT_SETTINGS: Settings = {
  version: SETTINGS_VERSION,
  enabled: true,
  quality: 'high',
  sharpness: DEFAULT_SHARPNESS,
  denoise: true,
  showInfo: false,
  compare: false,
  minScale: 1.05,
  siteMode: 'all',
  blockedSites: [],
  allowedSites: [],
};

/** i18n keys of each quality: full label (popup) and short one (label on the video). */
export const QUALITY_KEYS: Record<Quality, { label: string; short: string }> = {
  high: { label: 'qualityHigh', short: 'qualityHighShort' },
  light: { label: 'qualityLight', short: 'qualityLightShort' },
};

/** Activation thresholds offered in the options (labels are i18n keys). */
export const MIN_SCALE_CHOICES: readonly { value: number; labelKey: string }[] = [
  { value: 1.05, labelKey: 'optionsMinScale105' },
  { value: 1.25, labelKey: 'optionsMinScale125' },
  { value: 1.5, labelKey: 'optionsMinScale150' },
  { value: 2, labelKey: 'optionsMinScale200' },
];

/** Sharpness in stops of attenuation (v0/v1) → linear % (v2): 0.2 stops → 87%. */
function stopsToPercent(stops: number): number {
  return Math.round(Math.pow(2, -stops) * 100);
}

/** v0/v1 fields translated to v2. */
function migrateV1(r: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...r };
  delete out.mode;
  const stops = typeof r.sharpness === 'number' && Number.isFinite(r.sharpness) ? r.sharpness : 0.2;
  out.sharpness = stopsToPercent(stops);
  switch (r.mode) {
    case 'easu': // FSR1 without sharpening
      out.quality = 'high';
      out.sharpness = 0;
      break;
    case 'bilinear-rcas':
      out.quality = 'light';
      break;
    default: // fsr, bilinear (= the browser alone) or missing
      out.quality = 'high';
  }
  return out;
}

/**
 * Turns any stored value (from older versions, or corrupted) into a valid schema of the
 * latest version. v0 (no `version`) has the same fields as v1.
 */
export function normalizeSettings(raw: unknown): Settings {
  let r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  if (Object.keys(r).length && (typeof r.version !== 'number' || r.version < 2)) r = migrateV1(r);
  const d = DEFAULT_SETTINGS;
  const bool = (k: keyof Settings) => (typeof r[k] === 'boolean' ? (r[k] as boolean) : (d[k] as boolean));
  const num = (k: keyof Settings, min: number, max: number) => {
    const v = r[k];
    return typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : (d[k] as number);
  };
  return {
    version: SETTINGS_VERSION,
    enabled: bool('enabled'),
    quality: QUALITIES.includes(r.quality as Quality) ? (r.quality as Quality) : d.quality,
    sharpness: Math.round(num('sharpness', 0, 100)),
    denoise: bool('denoise'),
    showInfo: bool('showInfo'),
    compare: bool('compare'),
    minScale: num('minScale', 1, 4),
    siteMode: r.siteMode === 'allowlist' ? 'allowlist' : 'all',
    blockedSites: normalizeHostList(r.blockedSites),
    allowedSites: normalizeHostList(r.allowedSites),
  };
}

/**
 * Normalized hostname from a URL or a hand-typed name: lowercase, without "www.", port,
 * path or trailing dot. null if it is not a website (about:, file:, moz-extension:…).
 */
export function normalizeHost(input: string | null | undefined): string | null {
  if (!input) return null;
  let s = input.trim().toLowerCase();
  if (!s) return null;
  if (s.includes('://')) {
    let url: URL;
    try {
      url = new URL(s);
    } catch {
      return null;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    s = url.hostname;
  } else {
    s = s.split(/[/?#]/)[0].replace(/:\d+$/, '');
  }
  s = s.replace(/\.$/, '').replace(/^www\./, '');
  return /^[a-z0-9.-]+$/.test(s) && !s.startsWith('.') && !s.includes('..') ? s : null;
}

export function normalizeHostList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const hosts = raw.map((h) => (typeof h === 'string' ? normalizeHost(h) : null)).filter((h): h is string => !!h);
  return [...new Set(hosts)].sort();
}

/** A "youtube.com" entry also covers its subdomains (m.youtube.com). */
function coversHost(entry: string, host: string): boolean {
  return host === entry || host.endsWith(`.${entry}`);
}

function siteMatches(list: readonly string[], host: string): boolean {
  return list.some((entry) => coversHost(entry, host));
}

/** Per-site rules, ignoring the master switch. A null host is always enabled. */
export function isSiteEnabled(s: Settings, host: string | null): boolean {
  if (!host) return s.siteMode === 'all';
  return s.siteMode === 'all' ? !siteMatches(s.blockedSites, host) : siteMatches(s.allowedSites, host);
}

export function isActiveOn(s: Settings, host: string | null): boolean {
  return s.enabled && isSiteEnabled(s, host);
}

/** List changes to enable or disable a site, consistent with the current site mode. */
export function setSiteEnabled(s: Settings, host: string, on: boolean): Pick<Settings, 'blockedSites' | 'allowedSites'> {
  // Also removes parent-domain entries covering the host (e.g. youtube.com for m.youtube.com).
  const without = (list: string[]) => list.filter((entry) => !coversHost(entry, host));
  const add = (list: string[]) => normalizeHostList([...list, host]);
  if (s.siteMode === 'all') {
    return { blockedSites: on ? without(s.blockedSites) : add(s.blockedSites), allowedSites: s.allowedSites };
  }
  return { blockedSites: s.blockedSites, allowedSites: on ? add(s.allowedSites) : without(s.allowedSites) };
}
