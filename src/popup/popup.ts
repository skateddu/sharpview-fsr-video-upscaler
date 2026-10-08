import { QUALITIES, type Quality } from '../core/modes';
import {
  QUALITY_KEYS,
  isSiteEnabled,
  loadSettings,
  normalizeHost,
  onSettingsChanged,
  saveSettings,
  setSiteEnabled,
  type Settings,
} from '../shared/settings';
import type { FrameStatus, Message } from '../shared/messages';
import { describeStatus, type VideoStatus } from '../shared/status';
import { hasSiteAccess, openOnboarding } from '../shared/permissions';
import { localizePage, t } from '../shared/i18n';
import { byId as $ } from '../shared/dom';

const enabled = $<HTMLInputElement>('enabled');
const siteRow = $<HTMLElement>('site-row');
const siteLabel = $<HTMLElement>('site');
const siteEnabled = $<HTMLInputElement>('site-enabled');
const controls = $<HTMLElement>('controls');
const quality = $<HTMLSelectElement>('quality');
const sharpness = $<HTMLInputElement>('sharpness');
const sharpnessVal = $<HTMLElement>('sharpness-val');
const denoiseField = $<HTMLElement>('denoise-field');
const denoise = $<HTMLInputElement>('denoise');
const showInfo = $<HTMLInputElement>('showInfo');
const compare = $<HTMLInputElement>('compare');
const videos = $<HTMLUListElement>('videos');

localizePage();
for (const q of QUALITIES) quality.add(new Option(t(QUALITY_KEYS[q].label), q));
$('version').textContent = `v${browser.runtime.getManifest().version}`;

const [[tab], loaded] = await Promise.all([browser.tabs.query({ active: true, currentWindow: true }), loadSettings()]);
let settings: Settings = loaded;
const host = normalizeHost(tab?.url);

function render(): void {
  enabled.checked = settings.enabled;
  siteLabel.textContent = host
    ? `${host}${settings.siteMode === 'allowlist' ? ` · ${t('popupAllowlistOnly')}` : ''}`
    : t('popupUnsupportedPage');
  siteEnabled.checked = isSiteEnabled(settings, host);
  siteEnabled.disabled = !host || !settings.enabled;
  siteRow.classList.toggle('disabled', siteEnabled.disabled);
  controls.classList.toggle('disabled', !settings.enabled);

  quality.value = settings.quality;
  sharpness.value = String(settings.sharpness);
  showSharpness();
  denoiseField.hidden = settings.sharpness === 0;
  denoise.checked = settings.denoise;
  showInfo.checked = settings.showInfo;
  compare.checked = settings.compare;
}

function showSharpness(): void {
  sharpnessVal.textContent = sharpness.value === '0' ? t('popupSharpnessOff') : `${sharpness.value}%`;
}

async function save(patch: Partial<Settings>): Promise<void> {
  settings = await saveSettings(patch);
  render();
}

enabled.addEventListener('change', () => save({ enabled: enabled.checked }));
siteEnabled.addEventListener('change', () => {
  if (host) save(setSiteEnabled(settings, host, siteEnabled.checked));
});
quality.addEventListener('change', () => save({ quality: quality.value as Quality }));
sharpness.addEventListener('input', showSharpness);
sharpness.addEventListener('change', () => save({ sharpness: Number(sharpness.value) }));
denoise.addEventListener('change', () => save({ denoise: denoise.checked }));
showInfo.addEventListener('change', () => save({ showInfo: showInfo.checked }));
compare.addEventListener('change', () => save({ compare: compare.checked }));

$('options').addEventListener('click', (e) => {
  e.preventDefault();
  browser.runtime.openOptionsPage();
  window.close();
});

// Permission must be requested from a page: the popup would close at the prompt.
$('grant').addEventListener('click', () => {
  openOnboarding();
  window.close();
});
hasSiteAccess().then((granted) => ($('permission').hidden = granted));

onSettingsChanged((s) => {
  settings = s;
  render();
});

// --- Live state of the tab's videos ---

function describe(v: VideoStatus): HTMLLIElement {
  const li = document.createElement('li');
  const main = document.createElement('div');
  main.className = 'video-main';
  const dot = document.createElement('span');
  dot.className = v.active ? 'dot on' : 'dot';
  main.append(dot, v.active ? `${v.input} → ${v.output} · ${v.fps} fps` : `${v.input} · ${t('popupNative')}`);
  const detail = document.createElement('div');
  detail.className = 'muted';
  detail.textContent = v.active
    ? [
        t(QUALITY_KEYS[v.quality].label),
        v.degraded ? t('popupReduced') : '',
        settings.compare ? t('popupCompare') : '',
      ]
        .filter(Boolean)
        .join(' · ')
    : describeStatus(v, t);
  li.append(main, detail);
  return li;
}

/** Last rendered state: the list is rebuilt only when it changes (polled every second). */
let shown = '';

async function refreshStatus(): Promise<void> {
  let status: FrameStatus | undefined;
  if (tab?.id !== undefined) {
    status = await browser.tabs.sendMessage(tab.id, { type: 'status' } satisfies Message).catch(() => undefined);
  }
  const key = JSON.stringify([status?.videos, settings]);
  if (key === shown) return;
  shown = key;
  const items = status?.videos.map(describe) ?? [];
  if (!items.length) {
    const li = document.createElement('li');
    li.className = 'muted';
    li.textContent = !settings.enabled
      ? t('popupUpscalingOff')
      : !isSiteEnabled(settings, host)
        ? t('popupSiteDisabled')
        : t('popupNoVideos');
    items.push(li);
  }
  videos.replaceChildren(...items);
}

render();
refreshStatus();
setInterval(refreshStatus, 1000);
