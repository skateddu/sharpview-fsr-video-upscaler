// Background (event page): shortcuts, per-tab badge, the tab's site for content scripts and
// permission onboarding. Clicking the toolbar icon opens the popup.
import { QUALITIES } from '../core/modes';
import { isSiteEnabled, loadSettings, normalizeHost, onSettingsChanged, updateSettings, type Settings } from '../shared/settings';
import { hasSiteAccess, openOnboarding } from '../shared/permissions';
import { log } from '../shared/log';
import type { Message } from '../shared/messages';

/** Current settings: loaded once per background lifetime, then kept up to date by onChanged. */
let settings = loadSettings();

async function updateBadge(tabId: number, url: string | undefined): Promise<void> {
  const s = await settings;
  const host = normalizeHost(url);
  // ON: active · OFF: excluded on this site · empty: turned off, or not a web page.
  const text = !s.enabled || !host ? '' : isSiteEnabled(s, host) ? 'ON' : 'OFF';
  await Promise.all([
    browser.action.setBadgeText({ tabId, text }),
    browser.action.setBadgeBackgroundColor({ tabId, color: text === 'ON' ? '#2b8a3e' : '#868e96' }),
  ]);
}

async function updateAllBadges(): Promise<void> {
  const tabs = await browser.tabs.query({});
  await Promise.all(tabs.map((t) => (t.id === undefined ? null : updateBadge(t.id, t.url))));
}

browser.tabs.onUpdated.addListener((tabId, change, tab) => {
  if (change.url || change.status === 'loading') updateBadge(tabId, tab.url);
});
browser.tabs.onActivated.addListener(async ({ tabId }) => {
  const tab = await browser.tabs.get(tabId);
  updateBadge(tabId, tab.url);
});

browser.runtime.onMessage.addListener((message: Message, sender) => {
  if (message?.type === 'get-site') return Promise.resolve(normalizeHost(sender.tab?.url));
});

/** Shortcuts: each change starts from the current value, queued (see updateSettings). */
const COMMANDS: Record<string, (s: Settings) => Partial<Settings>> = {
  toggle: (s) => ({ enabled: !s.enabled }),
  'toggle-quality': (s) => ({ quality: QUALITIES[(QUALITIES.indexOf(s.quality) + 1) % QUALITIES.length], enabled: true }),
  'toggle-info': (s) => ({ showInfo: !s.showInfo }),
  'toggle-compare': (s) => ({ compare: !s.compare }),
};

browser.commands.onCommand.addListener((command) => {
  const change = COMMANDS[command];
  if (change) updateSettings(change);
});

browser.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason === 'install' && !(await hasSiteAccess())) await openOnboarding();
});

onSettingsChanged((s) => {
  settings = Promise.resolve(s);
  updateAllBadges();
});
updateAllBadges();
Promise.all([settings, hasSiteAccess()]).then(([s, granted]) =>
  log('background started:', s.enabled ? 'on' : 'off', '· site access', granted ? 'granted' : 'NOT granted'),
);
