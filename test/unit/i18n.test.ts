// Translation catalogs: same keys and placeholders in every language, and every key used by
// the code, the HTML pages and the manifest exists.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { STATUS_CODES, statusMessage } from '../../src/shared/status.ts';
import { MIN_SCALE_CHOICES } from '../../src/shared/schema.ts';

type Catalog = Record<string, { message: string; placeholders?: Record<string, { content: string }> }>;

const LOCALES = 'extension/_locales';
const catalogs: Record<string, Catalog> = Object.fromEntries(
  readdirSync(LOCALES).map((lang) => [lang, JSON.parse(readFileSync(join(LOCALES, lang, 'messages.json'), 'utf8'))]),
);
const en = catalogs.en;

function filesUnder(dir: string, ext: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile() && d.name.endsWith(ext))
    .map((d) => join(d.parentPath, d.name));
}

/** Keys used in source code (t('…') and static key tables), HTML (data-i18n*) and the manifest. */
function usedKeys(): Set<string> {
  const keys = new Set<string>();
  for (const file of filesUnder('src', '.ts')) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/\bt\(\s*'([A-Za-z0-9_]+)'/g)) keys.add(m[1]);
    for (const m of src.matchAll(/'((?:quality|popup|label|options|onboarding|status)[A-Z][A-Za-z0-9]*)'/g)) keys.add(m[1]);
  }
  for (const file of filesUnder('extension', '.html')) {
    for (const m of readFileSync(file, 'utf8').matchAll(/data-i18n(?:-[a-z-]+)?="([^"]+)"/g)) keys.add(m[1]);
  }
  for (const m of readFileSync('extension/manifest.json', 'utf8').matchAll(/__MSG_([A-Za-z0-9_]+)__/g)) keys.add(m[1]);
  return keys;
}

test('English is the reference language and Italian is provided', () => {
  const manifest = JSON.parse(readFileSync('extension/manifest.json', 'utf8'));
  assert.equal(manifest.default_locale, 'en');
  assert.ok(catalogs.en && catalogs.it);
});

test('every language has exactly the keys of the English catalog', () => {
  for (const [lang, catalog] of Object.entries(catalogs)) {
    assert.deepEqual(Object.keys(catalog).sort(), Object.keys(en).sort(), lang);
  }
});

test('placeholders match across languages and appear in the message', () => {
  for (const [lang, catalog] of Object.entries(catalogs)) {
    for (const [key, entry] of Object.entries(catalog)) {
      const names = Object.keys(entry.placeholders ?? {}).sort();
      assert.deepEqual(names, Object.keys(en[key].placeholders ?? {}).sort(), `${lang}.${key}`);
      for (const name of names) assert.ok(entry.message.toLowerCase().includes(`$${name}$`), `${lang}.${key} uses $${name}$`);
      assert.ok(entry.message.trim().length > 0, `${lang}.${key} is not empty`);
    }
  }
});

test('every key used by code, pages and manifest exists', () => {
  const missing = [...usedKeys()].filter((k) => !(k in en));
  assert.deepEqual(missing, []);
});

test('every status code and activation threshold has a message', () => {
  for (const code of STATUS_CODES) assert.ok(statusMessage({ code }).key in en, code);
  for (const c of MIN_SCALE_CHOICES) assert.ok(c.labelKey in en, c.labelKey);
});

test('the fallback translator fills placeholders like browser.i18n', async () => {
  const { t } = await import('../../src/shared/i18n.ts');
  assert.equal(t('statusNotNeeded', ['0.62']), 'Not needed: the video is already as large as the player (×0.62)');
  assert.equal(t('labelNative', 'Loading…'), 'native · Loading…');
  assert.equal(t('popupQuality'), 'Quality');
  assert.equal(t('noSuchKey'), 'noSuchKey');
});
