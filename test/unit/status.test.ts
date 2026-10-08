import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PERMANENT_CODES, STATUS_CODES, describeStatus, statusMessage } from '../../src/shared/status.ts';

/** Fake translation: key plus substitutions, to check what describeStatus passes along. */
const fakeT = (key: string, subs?: string[]) => (subs?.length ? `${key}[${subs.join(',')}]` : key);

test('every code has its own message key', () => {
  const keys = STATUS_CODES.map((code) => statusMessage({ code }).key);
  assert.equal(new Set(keys).size, STATUS_CODES.length);
  for (const key of keys) assert.match(key, /^status[A-Z]/);
});

test('details reach the message', () => {
  assert.equal(describeStatus({ code: 'not-needed', detail: '0.62' }, fakeT), 'statusNotNeeded[0.62]');
  assert.equal(describeStatus({ code: 'webgl-error', detail: 'WebGL2 not available' }, fakeT), 'statusWebglError (WebGL2 not available)');
  assert.equal(describeStatus({ code: 'render-error' }, fakeT), 'statusRenderError');
  assert.equal(describeStatus({ code: 'drm', detail: 'ignored' }, fakeT), 'statusDrm');
});

test('only source-related failures are permanent', () => {
  assert.deepEqual([...PERMANENT_CODES].sort(), ['cross-origin', 'drm', 'render-error', 'webgl-error']);
});
