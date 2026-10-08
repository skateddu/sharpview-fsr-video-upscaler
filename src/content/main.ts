// Content script: applies the settings (global and per site) and answers the popup.
import { Controller } from './controller';
import { isActiveOn, loadSettings, normalizeHost, onSettingsChanged, type Settings } from '../shared/settings';
import { log } from '../shared/log';
import type { FrameStatus, Message } from '../shared/messages';

const controller = new Controller();
let settings: Settings | null = null;
let host: string | null = null;

function apply(): void {
  if (settings) controller.setSettings(settings, isActiveOn(settings, host));
}

browser.runtime.onMessage.addListener((message: Message) => {
  if (message?.type !== 'status') return;
  const videos = controller.snapshot().filter((v) => v.relevant);
  // Only frames with videos answer: the popup gets the first useful answer.
  if (videos.length) return Promise.resolve<FrameStatus>({ frame: location.host, videos });
});

onSettingsChanged((s) => {
  settings = s;
  apply();
});

(async () => {
  // The site is the tab's, even inside iframes (e.g. an embedded player).
  const [site, loaded] = await Promise.all([
    browser.runtime.sendMessage({ type: 'get-site' } satisfies Message).catch(() => undefined),
    loadSettings(),
  ]);
  host = typeof site === 'string' ? site : normalizeHost(location.href);
  settings = loaded;
  if (window === window.top) log('content script', host, isActiveOn(settings, host) ? 'active' : 'inactive');
  apply();
})();
