import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SETTINGS,
  isActiveOn,
  isSiteEnabled,
  normalizeHost,
  normalizeSettings,
  setSiteEnabled,
  type Settings,
} from '../../src/shared/schema.ts';

const settings = (patch: Partial<Settings> = {}): Settings => ({ ...DEFAULT_SETTINGS, ...patch });

test('normalizeHost: URLs and hand-typed names', () => {
  assert.equal(normalizeHost('https://www.YouTube.com/watch?v=x'), 'youtube.com');
  assert.equal(normalizeHost('http://m.youtube.com:8080/a'), 'm.youtube.com');
  assert.equal(normalizeHost('  www.twitch.tv/  '), 'twitch.tv');
  assert.equal(normalizeHost('vimeo.com.'), 'vimeo.com');
  assert.equal(normalizeHost('localhost:3000'), 'localhost');
});

test('normalizeHost: non-web pages and invalid input', () => {
  for (const s of ['about:addons', 'moz-extension://abc/popup.html', 'file:///c:/x.mp4', '', '   ', 'a b', '.com', 'a..b', null, undefined]) {
    assert.equal(normalizeHost(s), null, String(s));
  }
});

test('"everywhere" mode: exclusion covers subdomains', () => {
  const s = settings({ blockedSites: ['youtube.com'] });
  assert.equal(isSiteEnabled(s, 'youtube.com'), false);
  assert.equal(isSiteEnabled(s, 'm.youtube.com'), false);
  assert.equal(isSiteEnabled(s, 'notyoutube.com'), true);
  assert.equal(isSiteEnabled(s, 'vimeo.com'), true);
});

test('"allowed sites only" mode', () => {
  const s = settings({ siteMode: 'allowlist', allowedSites: ['twitch.tv'] });
  assert.equal(isSiteEnabled(s, 'twitch.tv'), true);
  assert.equal(isSiteEnabled(s, 'clips.twitch.tv'), true);
  assert.equal(isSiteEnabled(s, 'youtube.com'), false);
  assert.equal(isSiteEnabled(s, null), false);
});

test('isActiveOn combines the master switch and the site rules', () => {
  assert.equal(isActiveOn(settings(), 'youtube.com'), true);
  assert.equal(isActiveOn(settings({ enabled: false }), 'youtube.com'), false);
  assert.equal(isActiveOn(settings({ blockedSites: ['youtube.com'] }), 'youtube.com'), false);
});

test('setSiteEnabled in "everywhere" mode', () => {
  let s = settings();
  s = { ...s, ...setSiteEnabled(s, 'm.youtube.com', false) };
  assert.deepEqual(s.blockedSites, ['m.youtube.com']);
  // Re-enabling a subdomain also removes the parent-domain entry that covered it.
  s = settings({ blockedSites: ['vimeo.com', 'youtube.com'] });
  s = { ...s, ...setSiteEnabled(s, 'm.youtube.com', true) };
  assert.deepEqual(s.blockedSites, ['vimeo.com']);
  assert.equal(isSiteEnabled(s, 'm.youtube.com'), true);
});

test('setSiteEnabled in "allowed sites only" mode', () => {
  let s = settings({ siteMode: 'allowlist' });
  s = { ...s, ...setSiteEnabled(s, 'twitch.tv', true) };
  assert.deepEqual(s.allowedSites, ['twitch.tv']);
  s = { ...s, ...setSiteEnabled(s, 'twitch.tv', false) };
  assert.deepEqual(s.allowedSites, []);
  assert.deepEqual(s.blockedSites, []);
});

test('normalizeSettings: valid settings are kept as they are', () => {
  const saved = { ...DEFAULT_SETTINGS, quality: 'light', sharpness: 2 };
  assert.deepEqual(normalizeSettings(saved), saved);
});

test('normalizeSettings: sharpenNative is off when missing (saved by 1.0.0)', () => {
  const { sharpenNative, ...saved } = { ...DEFAULT_SETTINGS, sharpenNative: true };
  assert.equal(normalizeSettings(saved).sharpenNative, false);
  assert.equal(normalizeSettings({ ...saved, sharpenNative }).sharpenNative, true);
  assert.equal(normalizeSettings({ ...saved, sharpenNative: 'yes' }).sharpenNative, false);
});

test('normalizeSettings: corrupted values → defaults or limits', () => {
  const s = normalizeSettings({
    version: 2,
    enabled: 'yes',
    quality: 'turbo',
    sharpness: 250,
    minScale: 0.2,
    siteMode: 'whatever',
    blockedSites: ['https://www.YouTube.com/x', 'youtube.com', 42, 'about:blank'],
  });
  assert.equal(s.enabled, true);
  assert.equal(s.quality, 'high');
  assert.equal(s.sharpness, 100);
  assert.equal(s.minScale, 1);
  assert.equal(s.siteMode, 'all');
  assert.deepEqual(s.blockedSites, ['youtube.com']);
  assert.equal(normalizeSettings({ version: 2, sharpness: -5 }).sharpness, 0);
  assert.equal(normalizeSettings({ version: 2, sharpness: 42.6 }).sharpness, 43);
  assert.deepEqual(normalizeSettings(null), DEFAULT_SETTINGS);
  assert.deepEqual(normalizeSettings('x'), DEFAULT_SETTINGS);
  assert.deepEqual(normalizeSettings({}), DEFAULT_SETTINGS);
});
