// Settings persistence in storage.sync (they follow the profile when Firefox Sync is on).
// node --test can import it too (with a simulated `browser`): hence the .ts extensions.
import { qualityMode, type Quality } from '../core/modes.ts';
import type { RenderOptions } from '../core/upscaler.ts';
import { normalizeSettings, type Settings } from './schema.ts';

export * from './schema.ts';

const KEY = 'settings';

export async function loadSettings(): Promise<Settings> {
  const stored = await browser.storage.sync.get(KEY);
  if (stored[KEY] !== undefined) return normalizeSettings(stored[KEY]);
  // Migration from v0, stored in storage.local.
  const legacy = await browser.storage.local.get(KEY);
  const settings = normalizeSettings(legacy[KEY]);
  if (legacy[KEY] !== undefined) {
    await browser.storage.sync.set({ [KEY]: settings });
    await browser.storage.local.remove(KEY);
  }
  return settings;
}

/** Queued writes: each change starts from the result of the previous one. */
let queue: Promise<unknown> = Promise.resolve();

/**
 * Changes the settings starting from their current value. Calls run one at a time, so two
 * shortcuts pressed in quick succession do not overwrite each other. Applies within one page
 * (background, popup, options): that is where bursts come from.
 */
export function updateSettings(change: (current: Settings) => Partial<Settings>): Promise<Settings> {
  const run = queue.then(async () => {
    const current = await loadSettings();
    const next = normalizeSettings({ ...current, ...change(current) });
    await browser.storage.sync.set({ [KEY]: next });
    return next;
  });
  queue = run.catch(() => {});
  return run;
}

export function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  return updateSettings(() => patch);
}

export function onSettingsChanged(callback: (settings: Settings) => void): void {
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes[KEY]) callback(normalizeSettings(changes[KEY].newValue));
  });
}

/** Rendering options for the settings, at the given quality (lower than chosen on a slow GPU). */
export function toRenderOptions(s: Settings, quality: Quality = s.quality): RenderOptions {
  return { mode: qualityMode(quality), sharpness: s.sharpness, denoise: s.denoise, split: s.compare ? 0.5 : -1 };
}
