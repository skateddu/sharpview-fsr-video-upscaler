// Renderer regression test: opens the playground in Firefox (Playwright) with the test
// pattern, renders every mode at ×3 and compares pixels with the reference images in
// test/golden. Also checks recovery after losing the WebGL context.
// Usage: npm run build && node scripts/render-test.mjs [--update-golden]
//
// The pattern contains text drawn by the browser: references depend a little on the
// machine's fonts and GPU. On another machine, regenerate them with --update-golden and
// check them by eye.
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { join } from 'node:path';
import { firefox } from 'playwright';
import { UPSCALE_MODES } from '../src/core/modes.ts';
import { reporter, serve, trackErrors } from './lib.mjs';

const ROOT = 'dist/playground';
const OUT = 'dist/render';
const GOLDEN = 'test/golden';
const UPDATE = process.argv.includes('--update-golden');
// Thresholds: mean difference per channel (0..255) and share of pixels differing by > 8.
const MAX_MEAN_DIFF = 0.5;
const MAX_PCT_OVER_8 = 0.5;
const { server, base } = await serve(ROOT);
const { expect, finish } = reporter();

await mkdir(OUT, { recursive: true });
await mkdir(GOLDEN, { recursive: true });
const browser = await firefox.launch();
const page = await browser.newPage({ viewport: { width: 1800, height: 1000 } });
const errors = trackErrors(page, base);

/** Draws synchronously and reads the WebGL canvas before it is presented. */
const snapshot = () => page.evaluate(() => {
  window.__playground.draw();
  return window.__playground.canvas.toDataURL('image/png');
});

const dataUrlToBuffer = (url) => Buffer.from(url.split(',')[1], 'base64');
const fileToDataUrl = async (path) => `data:image/png;base64,${(await readFile(path)).toString('base64')}`;

/** Pixel comparison in the browser (PNG decoding without dependencies). */
const compare = (a, b) => page.evaluate(async ([a, b]) => {
  const load = (src) => new Promise((ok, ko) => {
    const img = new Image();
    img.onload = () => ok(img);
    img.onerror = ko;
    img.src = src;
  });
  const [ia, ib] = await Promise.all([load(a), load(b)]);
  if (ia.width !== ib.width || ia.height !== ib.height) {
    return { sizeMismatch: `${ia.width}×${ia.height} vs ${ib.width}×${ib.height}` };
  }
  const pixels = (img) => {
    const c = Object.assign(document.createElement('canvas'), { width: img.width, height: img.height });
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    return ctx.getImageData(0, 0, img.width, img.height).data;
  };
  const pa = pixels(ia);
  const pb = pixels(ib);
  let sum = 0;
  let over = 0;
  for (let i = 0; i < pa.length; i += 4) {
    let max = 0;
    for (let k = 0; k < 3; k++) {
      const d = Math.abs(pa[i + k] - pb[i + k]);
      sum += d;
      if (d > max) max = d;
    }
    if (max > 8) over++;
  }
  const n = pa.length / 4;
  return { mean: sum / (n * 3), pctOver8: (over / n) * 100 };
}, [a, b]);

const check = async (name, dataUrl, golden = name) => {
  await writeFile(join(OUT, `${name}.png`), dataUrlToBuffer(dataUrl));
  const goldenPath = join(GOLDEN, `${golden}.png`);
  const exists = await access(goldenPath).then(() => true, () => false);
  if ((UPDATE || !exists) && golden === name) {
    await writeFile(goldenPath, dataUrlToBuffer(dataUrl));
    expect(name, true, `reference ${exists ? 'updated' : 'created'}`);
    return;
  }
  const r = await compare(dataUrl, await fileToDataUrl(goldenPath));
  const ok = !r.sizeMismatch && r.mean <= MAX_MEAN_DIFF && r.pctOver8 <= MAX_PCT_OVER_8;
  expect(name, ok, r.sizeMismatch ?? `mean diff ${r.mean.toFixed(3)}, pixels >8: ${r.pctOver8.toFixed(3)}%`);
};

for (const mode of UPSCALE_MODES) {
  await page.goto(`${base}?pattern&mode=${mode}&out=x3`);
  await page.waitForFunction(() => document.body.dataset.status !== undefined, null, { timeout: 10000 });
  const status = await page.evaluate(() => document.body.dataset.status);
  if (status !== 'ok') {
    expect(mode, false, await page.locator('#status').textContent());
    continue;
  }
  await check(mode, await snapshot());
}

// Context loss and restore: rendering must resume identically.
await page.goto(`${base}?pattern&mode=fsr&out=x3`);
await page.waitForFunction(() => document.body.dataset.status === 'ok');
const restored = await page.evaluate(async () => {
  const { canvas, upscaler } = window.__playground;
  const ext = upscaler().gl.getExtension('WEBGL_lose_context');
  const wait = (type) => new Promise((r) => canvas.addEventListener(type, r, { once: true }));
  const lost = wait('webglcontextlost');
  ext.loseContext();
  await lost;
  window.__playground.draw(); // must not throw while the context is lost
  const back = wait('webglcontextrestored');
  ext.restoreContext();
  await back;
  return !upscaler().contextLost;
});
if (restored) await check('fsr-after-restore', await snapshot(), 'fsr');
else expect('context-restore', false, 'context not restored');

await page.click('#bench');
await page.waitForFunction(() => document.getElementById('bench-result').textContent !== '');
console.log(await page.locator('#bench-result').textContent());

expect('no page errors', !errors.length, errors.join(' | '));
await finish(() => browser.close(), () => server.close());
