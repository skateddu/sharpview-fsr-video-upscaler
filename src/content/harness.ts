// Test entry: the content script logic without extension APIs, driven by scripts/e2e.mjs.
import { Controller } from './controller';
import { DEFAULT_SETTINGS, normalizeSettings, type Settings } from '../shared/schema';

let settings: Settings = { ...DEFAULT_SETTINGS, showInfo: true };
const controller = new Controller();
controller.setSettings(settings, settings.enabled);

(globalThis as any).__videoUpscaler = {
  set(patch: Partial<Settings>) {
    settings = normalizeSettings({ ...settings, ...patch });
    controller.setSettings(settings, settings.enabled);
  },
  status: () => controller.snapshot(),
  degrade: () => controller.degradeAll(),
};
