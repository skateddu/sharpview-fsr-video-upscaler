import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateLayout, isTranslationOnly, type LayoutInput } from '../../src/content/layout.ts';

const base: LayoutInput = {
  videoWidth: 640,
  videoHeight: 360,
  boxWidth: 960,
  boxHeight: 720,
  display: 'block',
  visibility: 'visible',
  transform: 'none',
  objectFit: 'contain',
  objectPosition: '50% 50%',
  devicePixelRatio: 2,
  minScale: 1.05,
};

test('eligible layout: content, clipping, scale and output', () => {
  const r = evaluateLayout(base);
  assert.ok(r.ok);
  assert.deepEqual(r.layout.content, { x: 0, y: 90, width: 960, height: 540 });
  assert.deepEqual(r.layout.clip, [0, 0, 0, 0]);
  assert.equal(r.layout.scale, 3);
  assert.deepEqual([r.layout.outWidth, r.layout.outHeight], [1920, 1080]);
});

test('cover: clipped on the sides', () => {
  const r = evaluateLayout({ ...base, boxWidth: 640, boxHeight: 640, objectFit: 'cover' });
  assert.ok(r.ok);
  const [t, right, b, l] = r.layout.clip;
  assert.equal(t + b, 0);
  assert.ok(l > 0 && Math.abs(l - right) < 1e-9);
});

test('reasons to stay native, in the order they are checked', () => {
  const code = (patch: Partial<LayoutInput>) => {
    const r = evaluateLayout({ ...base, ...patch });
    return r.ok ? 'ok' : r.status.code;
  };
  assert.equal(code({ display: 'none' }), 'hidden');
  assert.equal(code({ visibility: 'hidden' }), 'hidden');
  assert.equal(code({ transform: 'matrix(1.1, 0, 0, 1.1, 0, 0)' }), 'transform');
  assert.equal(code({ boxWidth: 100 }), 'too-small');
  assert.equal(code({ devicePixelRatio: 0.5 }), 'not-needed');
  // A hidden video is not judged by size or scale.
  assert.equal(code({ display: 'none', boxWidth: 10 }), 'hidden');
});

test('not-needed reports the scale with two decimals', () => {
  const r = evaluateLayout({ ...base, devicePixelRatio: 1, boxWidth: 640, boxHeight: 360 });
  assert.ok(!r.ok);
  assert.deepEqual(r.status, { code: 'not-needed', detail: '1.00' });
});

test('the activation threshold is inclusive', () => {
  assert.ok(evaluateLayout({ ...base, minScale: 3 }).ok);
  assert.ok(!evaluateLayout({ ...base, minScale: 3.01 }).ok);
});

test('isTranslationOnly', () => {
  assert.equal(isTranslationOnly('none'), true);
  assert.equal(isTranslationOnly(''), true);
  assert.equal(isTranslationOnly('matrix(1, 0, 0, 1, -320, -180)'), true);
  assert.equal(isTranslationOnly('matrix(-1, 0, 0, 1, 0, 0)'), false);
  assert.equal(isTranslationOnly('matrix(0.866, 0.5, -0.5, 0.866, 0, 0)'), false);
  assert.equal(isTranslationOnly('matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)'), false);
});
