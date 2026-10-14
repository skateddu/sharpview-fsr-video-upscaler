/*
 * Popup and options tests with a fake `browser` (in-memory storage, a YouTube tab with videos,
 * optional i18n catalog). Screenshots go to dist/ui.
 * Usage: npm run build && node scripts/ui-test.mjs
 */
import { readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { firefox } from 'playwright';
import { formatMessage } from '../src/shared/i18n.ts';
import { reporter, serve, trackErrors } from './lib.mjs';

const OUT = 'dist/ui';
const catalog = async (lang) => JSON.parse(await readFile(`extension/_locales/${lang}/messages.json`, 'utf8'));
const italian = await catalog('it');
const { server, base } = await serve('dist/extension');

/** Fake `browser` namespace, injected before the page's scripts. */
function stub({ granted, stored, catalog, lang, formatSource }) {
  const area = (data) => ({
    async get(key) {
      return key in data ? { [key]: structuredClone(data[key]) } : {};
    },
    async set(obj) {
      for (const [k, v] of Object.entries(obj)) {
        const oldValue = data[k];
        data[k] = structuredClone(v);
        for (const l of listeners) l({ [k]: { oldValue, newValue: structuredClone(v) } }, 'sync');
      }
    },
  });
  const sync = stored ?? {};
  const listeners = [];
  const video = (o) => ({ id: '', session: 1, relevant: true, quality: 'high', sharpenOnly: false, degraded: false, costMs: 0, frames: 100, canvasRect: null, ...o });
  window.__stub = { sync, opened: [] };
  window.browser = {
    storage: { sync: area(sync), onChanged: { addListener: (l) => listeners.push(l) } },
    runtime: {
      getManifest: () => ({ version: '1.0.0' }),
      getURL: (p) => `moz-extension://test/${p}`,
      openOptionsPage: async () => window.__stub.opened.push('options'),
    },
    tabs: {
      query: async () => [{ id: 1, url: 'https://www.youtube.com/watch?v=x' }],
      sendMessage: async () => ({
        frame: 'www.youtube.com',
        videos: [
          video({ active: true, code: 'active', input: '854×480', output: '2560×1440', fps: 60, videoFps: 60, costMs: 1.8 }),
          video({ active: true, code: 'active', sharpenOnly: true, input: '1920×1080', output: '1920×1080', fps: 30, videoFps: 30, costMs: 0.6 }),
          video({ active: false, code: 'not-needed', detail: '0.62', input: '1280×720', output: '0×0', fps: 0, videoFps: 30 }),
        ],
      }),
      create: async ({ url }) => window.__stub.opened.push(url),
    },
    permissions: { contains: async () => granted },
    commands: {
      getAll: async () => [
        { name: '_execute_action', shortcut: '', description: 'Open the popup' },
        { name: 'toggle', shortcut: 'Alt+Shift+U', description: 'Turn upscaling on/off' },
        { name: 'toggle-quality', shortcut: 'Alt+Shift+G', description: 'Switch quality' },
        { name: 'toggle-info', shortcut: 'Alt+Shift+I', description: 'Info on the video' },
        { name: 'toggle-compare', shortcut: 'Alt+Shift+O', description: 'A/B comparison' },
      ],
    },
  };
  if (catalog) {
    // The extension's own formatter (src/shared/i18n.ts), same rules as browser.i18n.
    const format = new Function(`return ${formatSource}`)();
    window.browser.i18n = { getUILanguage: () => lang, getMessage: (key, subs) => format(catalog[key], subs) };
  }
  window.close = () => {};
}

const browser = await firefox.launch();
await mkdir(OUT, { recursive: true });
const { expect, finish } = reporter();

async function open(path, { scheme = 'light', granted = true, stored, viewport, catalog, lang } = {}) {
  const context = await browser.newContext({ colorScheme: scheme, viewport: viewport ?? { width: 320, height: 600 } });
  await context.addInitScript(stub, { granted, stored, catalog, lang, formatSource: formatMessage.toString() });
  const page = await context.newPage();
  const errors = trackErrors(page, base);
  await page.goto(base + path);
  await page.waitForLoadState('networkidle');
  return { page, context, errors };
}

const settingsOf = (page) => page.evaluate(() => window.__stub.sync.settings);

// --- Popup ---
for (const scheme of ['light', 'dark']) {
  const { page, context } = await open('popup.html', { scheme });
  await page.waitForSelector('#videos .dot');
  await page.screenshot({ path: join(OUT, `popup-${scheme}.png`), fullPage: true });
  await context.close();
}

{
  const { page, context, errors } = await open('popup.html');
  await page.waitForSelector('#videos .dot');
  expect('popup: tab site', (await page.textContent('#site')).startsWith('youtube.com'));
  expect('popup: video states', (await page.locator('#videos li').count()) === 3);
  expect('popup: active video described', (await page.textContent('#videos')).includes('854×480 → 2560×1440 · 60 fps · 1.8 ms'));
  expect('popup: sharpening only described', (await page.textContent('#videos')).includes('Sharpening only (RCAS)'));
  expect('popup: native video explained', (await page.textContent('#videos')).includes('(×0.62)'));

  await page.click('#site-enabled');
  let s = await settingsOf(page);
  expect('popup: site switch → excluded', s?.blockedSites?.join() === 'youtube.com', JSON.stringify(s?.blockedSites));
  await page.click('#site-enabled');
  s = await settingsOf(page);
  expect('popup: site switch → enabled again', s.blockedSites.length === 0);

  expect('popup: two qualities', (await page.locator('#quality option').count()) === 2);
  await page.selectOption('#quality', 'light');
  s = await settingsOf(page);
  expect('popup: quality saved', s.quality === 'light');
  await page.selectOption('#quality', 'high');

  await page.locator('#sharpness').fill('50');
  s = await settingsOf(page);
  expect('popup: sharpness 50%', s.sharpness === 50, String(s.sharpness));
  await page.locator('#sharpness').fill('0');
  s = await settingsOf(page);
  expect('popup: sharpness 0 → off', s.sharpness === 0 && (await page.textContent('#sharpness-val')) === 'Off');
  expect('popup: denoise hidden when sharpening is off', await page.locator('#denoise-field').isHidden());
  await page.locator('#sharpness').fill('87');

  await page.click('#compare');
  expect('popup: A/B comparison saved', (await settingsOf(page)).compare === true);

  await page.click('#enabled');
  s = await settingsOf(page);
  expect('popup: master switch', s.enabled === false);
  expect('popup: site switch disabled while off', await page.locator('#site-enabled').isDisabled());

  await page.click('#options');
  expect('popup: link to the options', (await page.evaluate(() => window.__stub.opened)).includes('options'));
  expect('popup: no errors', errors.length === 0, errors.join(' | '));
  await context.close();
}

{
  const { page, context } = await open('popup.html', { granted: false });
  expect('popup: missing permission notice', await page.locator('#permission').isVisible());
  await page.screenshot({ path: join(OUT, 'popup-no-permission.png'), fullPage: true });
  await page.click('#grant');
  const opened = await page.evaluate(() => window.__stub.opened);
  expect('popup: opens the permission page', opened.some((u) => u.endsWith('onboarding.html')));
  await context.close();
}

{
  // Localization: Italian catalog.
  const { page, context, errors } = await open('popup.html', { catalog: italian, lang: 'it' });
  await page.waitForSelector('#videos .dot');
  await page.screenshot({ path: join(OUT, 'popup-it.png'), fullPage: true });
  const text = await page.textContent('body');
  expect('popup (it): static texts', text.includes('Qualità') && text.includes('Video in questa scheda') && text.includes('Altre impostazioni'));
  expect('popup (it): dynamic texts', text.includes('Bilineare + RCAS') && text.includes('Non serve') && text.includes('nativo'));
  expect('popup (it): page language', (await page.getAttribute('html', 'lang')) === 'it');
  expect('popup (it): no English left', !/Quality|Sharpness|More settings|Videos in this tab/.test(text), text.slice(0, 120));
  expect('popup (it): no errors', errors.length === 0, errors.join(' | '));
  await context.close();
}

// --- Options ---
for (const scheme of ['light', 'dark']) {
  const { page, context } = await open('options.html', { scheme, viewport: { width: 900, height: 900 } });
  await page.waitForSelector('#shortcuts tr');
  await page.screenshot({ path: join(OUT, `options-${scheme}.png`), fullPage: true });
  await context.close();
}

{
  const { page, context, errors } = await open('options.html', { viewport: { width: 900, height: 900 } });
  await page.waitForSelector('#shortcuts tr');
  expect('options: shortcuts listed', (await page.locator('#shortcuts tr').count()) === 5);
  expect('options: thresholds from the schema', (await page.locator('#minScale option').count()) === 4);

  await page.fill('#blockedSites', 'https://www.Example.com/video\nvimeo.com, not valid!\n\nvimeo.com');
  await page.locator('#blockedSites').blur();
  let s = await settingsOf(page);
  expect('options: excluded list normalized', s?.blockedSites?.join() === 'example.com,vimeo.com', JSON.stringify(s?.blockedSites));

  await page.check('input[name=siteMode][value=allowlist]');
  s = await settingsOf(page);
  expect('options: allowed sites only mode', s.siteMode === 'allowlist');

  await page.selectOption('#minScale', '1.5');
  expect('options: threshold saved', (await settingsOf(page)).minScale === 1.5);

  await page.check('#sharpenNative');
  expect('options: sharpen native saved', (await settingsOf(page)).sharpenNative === true);

  page.once('dialog', (d) => d.accept());
  await page.click('#reset');
  await page.waitForTimeout(200);
  s = await settingsOf(page);
  expect('options: reset', s.siteMode === 'all' && s.blockedSites.length === 0 && s.minScale === 1.05 && !s.sharpenNative);
  expect('options: reset unchecks sharpen native', !(await page.isChecked('#sharpenNative')));
  expect('options: no errors', errors.length === 0, errors.join(' | '));
  await context.close();
}

{
  const { page, context } = await open('options.html', { viewport: { width: 900, height: 900 }, catalog: italian, lang: 'it' });
  await page.waitForSelector('#shortcuts tr');
  await page.screenshot({ path: join(OUT, 'options-it.png'), fullPage: true });
  const text = await page.textContent('body');
  expect('options (it): localized', text.includes('Siti esclusi') && text.includes('Scorciatoie') && text.includes('consigliato'));
  expect('options (it): title', (await page.title()) === 'Sharpview · Impostazioni');
  await context.close();
}

// The other languages: translated and no wider than the popup (German strings are the longest).
for (const lang of ['de', 'fr', 'es']) {
  const messages = await catalog(lang);
  const pages = [['popup.html', {}], ['options.html', { viewport: { width: 900, height: 900 } }]];
  for (const [path, options] of pages) {
    const { page, context, errors } = await open(path, { ...options, catalog: messages, lang });
    await page.waitForSelector(path === 'popup.html' ? '#videos .dot' : '#shortcuts tr');
    await page.screenshot({ path: join(OUT, `${path.replace('.html', '')}-${lang}.png`), fullPage: true });
    const key = path === 'popup.html' ? 'popupQuality' : 'optionsSites';
    expect(`${path} (${lang}): localized`, (await page.textContent('body')).includes(messages[key].message));
    expect(`${path} (${lang}): no horizontal overflow`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    expect(`${path} (${lang}): no errors`, errors.length === 0, errors.join(' | '));
    await context.close();
  }
}

await finish(() => browser.close(), () => server.close());
