import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Simulated storage.sync with asynchronous reads and writes, like the real one.
let sync: Record<string, unknown> = {};
const tick = () => new Promise((r) => setTimeout(r, Math.random() * 3));
(globalThis as any).browser = {
  storage: {
    sync: {
      get: async (key: string) => {
        await tick();
        return key in sync ? { [key]: structuredClone(sync[key]) } : {};
      },
      set: async (obj: Record<string, unknown>) => {
        await tick();
        Object.assign(sync, structuredClone(obj));
      },
    },
    local: { get: async () => ({}), remove: async () => {} },
    onChanged: { addListener: () => {} },
  },
};

const { updateSettings, saveSettings, loadSettings, toRenderOptions, DEFAULT_SETTINGS } = await import('../../src/shared/settings.ts');

beforeEach(() => {
  sync = {};
});

test('updateSettings: changes in quick succession are not lost', async () => {
  // 11 toggles fired together (like a shortcut held down): starting from on, an odd number of
  // toggles must leave it off.
  await Promise.all(Array.from({ length: 11 }, () => updateSettings((s) => ({ enabled: !s.enabled }))));
  assert.equal((await loadSettings()).enabled, false);
});

test('updateSettings: different changes in parallel add up', async () => {
  await Promise.all([
    saveSettings({ showInfo: true }),
    saveSettings({ compare: true }),
    updateSettings((s) => ({ sharpness: s.sharpness - 7 })),
    updateSettings((s) => ({ sharpness: s.sharpness - 10 })),
  ]);
  const s = await loadSettings();
  assert.equal(s.showInfo, true);
  assert.equal(s.compare, true);
  assert.equal(s.sharpness, DEFAULT_SETTINGS.sharpness - 17);
});

test('updateSettings: an error does not block the queue', async () => {
  await assert.rejects(updateSettings(() => {
    throw new Error('boom');
  }));
  await saveSettings({ showInfo: true });
  assert.equal((await loadSettings()).showInfo, true);
});

test('toRenderOptions: quality, sharpness and comparison', () => {
  assert.deepEqual(toRenderOptions({ ...DEFAULT_SETTINGS, quality: 'light', sharpness: 50, compare: true }), {
    mode: 'bilinear-rcas',
    sharpness: 50,
    denoise: true,
    split: 0.5,
  });
  assert.equal(toRenderOptions(DEFAULT_SETTINGS).mode, 'fsr');
  // Effective quality lower than the chosen one (slow GPU).
  assert.equal(toRenderOptions(DEFAULT_SETTINGS, 'light').mode, 'bilinear-rcas');
});
