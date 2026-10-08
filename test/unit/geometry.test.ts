import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contentRect, clipInsets } from '../../src/core/geometry.ts';

test('contain: letterbox above and below', () => {
  assert.deepEqual(contentRect('contain', 1920, 1080, 960, 720), { x: 0, y: 90, width: 960, height: 540 });
});

test('contain: pillarbox on the sides', () => {
  assert.deepEqual(contentRect('contain', 640, 480, 1280, 720), { x: 160, y: 0, width: 960, height: 720 });
});

test('fill: fills the box, distorting', () => {
  assert.deepEqual(contentRect('fill', 640, 360, 800, 300), { x: 0, y: 0, width: 800, height: 300 });
});

test('cover: extends beyond the box, centered', () => {
  const r = contentRect('cover', 1280, 720, 640, 640);
  assert.equal(r.height, 640);
  assert.ok(Math.abs(r.width - 1137.78) < 0.01);
  assert.ok(Math.abs(r.x - (640 - r.width) / 2) < 1e-9);
  assert.equal(r.y, 0);
});

test('none and scale-down', () => {
  assert.deepEqual(contentRect('none', 320, 180, 640, 360), { x: 160, y: 90, width: 320, height: 180 });
  assert.deepEqual(contentRect('scale-down', 320, 180, 640, 360), { x: 160, y: 90, width: 320, height: 180 });
  assert.deepEqual(contentRect('scale-down', 1280, 720, 640, 360), { x: 0, y: 0, width: 640, height: 360 });
});

test('unknown value: behaves like contain', () => {
  assert.deepEqual(contentRect('', 1920, 1080, 960, 720), contentRect('contain', 1920, 1080, 960, 720));
});

test('clipInsets: no clipping when the content is inside the box', () => {
  assert.deepEqual(clipInsets({ x: 0, y: 90, width: 960, height: 540 }, 960, 720), [0, 0, 0, 0]);
});

test('clipInsets: symmetric clipping for cover', () => {
  const r = contentRect('cover', 1280, 720, 640, 640);
  const [t, right, b, l] = clipInsets(r, 640, 640);
  assert.equal(t, 0);
  assert.equal(b, 0);
  assert.ok(Math.abs(l - right) < 1e-9);
  assert.ok(Math.abs(l - (r.width - 640) / 2) < 1e-9);
});

test('object-position: top-left corner and px', () => {
  assert.deepEqual(contentRect('contain', 1920, 1080, 960, 720, '0% 0%'), { x: 0, y: 0, width: 960, height: 540 });
  assert.deepEqual(contentRect('contain', 1920, 1080, 960, 720, '100% 100%'), { x: 0, y: 180, width: 960, height: 540 });
  assert.deepEqual(contentRect('none', 320, 180, 640, 360, '10px 20px'), { x: 10, y: 20, width: 320, height: 180 });
});

test('object-position: unsupported values → center', () => {
  const center = contentRect('contain', 1920, 1080, 960, 720);
  assert.deepEqual(contentRect('contain', 1920, 1080, 960, 720, 'calc(10% + 5px) 50%'), center);
  assert.deepEqual(contentRect('contain', 1920, 1080, 960, 720, ''), center);
});

test('object-position does not affect fill', () => {
  assert.deepEqual(contentRect('fill', 640, 360, 800, 300, '0% 0%'), { x: 0, y: 0, width: 800, height: 300 });
});
