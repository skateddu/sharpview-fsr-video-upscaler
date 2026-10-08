import {
  DEFAULT_SETTINGS,
  MIN_SCALE_CHOICES,
  loadSettings,
  normalizeHost,
  onSettingsChanged,
  saveSettings,
  type Settings,
  type SiteMode,
} from '../shared/settings';
import { localizePage, t } from '../shared/i18n';
import { openShortcutSettings, renderShortcuts, shortcutSettingsAvailable } from '../shared/shortcuts';
import { byId as $ } from '../shared/dom';



const radios = [...document.querySelectorAll<HTMLInputElement>('input[name=siteMode]')];
const blocked = $<HTMLTextAreaElement>('blockedSites');
const allowed = $<HTMLTextAreaElement>('allowedSites');
const minScale = $<HTMLSelectElement>('minScale');
const saved = $<HTMLElement>('saved');

localizePage();
document.title = t('optionsTitle');
for (const c of MIN_SCALE_CHOICES) minScale.add(new Option(t(c.labelKey), String(c.value)));

let settings: Settings;
let savedTimer = 0;

function render(): void {
  for (const r of radios) r.checked = r.value === settings.siteMode;
  // Do not overwrite a list while it is being edited.
  if (document.activeElement !== blocked) blocked.value = settings.blockedSites.join('\n');
  if (document.activeElement !== allowed) allowed.value = settings.allowedSites.join('\n');
  $('blocked-field').classList.toggle('inactive', settings.siteMode !== 'all');
  $('allowed-field').classList.toggle('inactive', settings.siteMode !== 'allowlist');
  // A value outside the list (set by hand or by a future version) stays visible.
  const value = String(settings.minScale);
  if (![...minScale.options].some((opt) => opt.value === value)) minScale.add(new Option(`×${value}`, value));
  minScale.value = value;
}

async function save(patch: Partial<Settings>): Promise<void> {
  settings = await saveSettings(patch);
  render();
  saved.classList.add('show');
  clearTimeout(savedTimer);
  savedTimer = window.setTimeout(() => saved.classList.remove('show'), 1500);
}

/** Lines (or comma-separated entries) → valid hostnames; pasted URLs are accepted too. */
function parseList(text: string): string[] {
  return text
    .split(/[\n,]+/)
    .map((line) => normalizeHost(line))
    .filter((h): h is string => !!h);
}

for (const r of radios) r.addEventListener('change', () => save({ siteMode: r.value as SiteMode }));
blocked.addEventListener('change', () => save({ blockedSites: parseList(blocked.value) }));
allowed.addEventListener('change', () => save({ allowedSites: parseList(allowed.value) }));
minScale.addEventListener('change', () => save({ minScale: Number(minScale.value) }));
$('reset').addEventListener('click', () => {
  if (confirm(t('optionsResetConfirm'))) save({ ...DEFAULT_SETTINGS });
});

// Shortcuts: the current list; the button only where Firefox can open its settings page.
await renderShortcuts($<HTMLTableElement>('shortcuts'));
if (shortcutSettingsAvailable()) {
  $('edit-shortcuts').hidden = false;
  $('shortcuts-hint').hidden = true;
  $('edit-shortcuts').addEventListener('click', openShortcutSettings);
}

onSettingsChanged((s) => {
  settings = s;
  render();
});
settings = await loadSettings();
render();
