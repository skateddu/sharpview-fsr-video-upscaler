// End-to-end test of the content script logic (dist/test/harness.js) in Firefox with
// Playwright, on a page with videos in different layouts (test/e2e/fixture.html).
// It does not load the extension (Playwright cannot in Firefox): toolbar, permissions and
// storage are tested by hand with `npm start`.
// Usage: npm run build && node scripts/e2e.mjs
import { writeFile, mkdir } from 'node:fs/promises';
import { firefox } from 'playwright';
import { reporter, serve, trackErrors } from './lib.mjs';

const SAMPLE = 'dist/e2e/sample.webm';
const SRC_W = 640;
const SRC_H = 360;

const browser = await firefox.launch();
const { expect, note, finish } = reporter();

// 1) A real test video (WebM VP8) recorded in the browser: no binary files in the repo.
{
  const page = await browser.newPage();
  const base64 = await page.evaluate(async ([w, h]) => {
    const c = Object.assign(document.createElement('canvas'), { width: w, height: h });
    const ctx = c.getContext('2d');
    let i = 0;
    const timer = setInterval(() => {
      ctx.fillStyle = `hsl(${(i * 7) % 360} 70% 45%)`;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#fff';
      ctx.font = '48px sans-serif';
      ctx.fillText(String(i++), 20, 60);
    }, 1000 / 30);
    const rec = new MediaRecorder(c.captureStream(30), { mimeType: 'video/webm' });
    const chunks = [];
    rec.ondataavailable = (e) => chunks.push(e.data);
    rec.start();
    await new Promise((r) => setTimeout(r, 3000));
    rec.stop();
    await new Promise((r) => (rec.onstop = r));
    clearInterval(timer);
    const buf = await new Blob(chunks).arrayBuffer();
    let s = '';
    for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
    return btoa(s);
  }, [SRC_W, SRC_H]);
  await mkdir('dist/e2e', { recursive: true });
  await writeFile(SAMPLE, Buffer.from(base64, 'base64'));
  await page.close();
}

// 2) Two origins: the page on "localhost", the cross-origin video on "127.0.0.1" without CORS.
const { server: main, base: pageUrl } = await serve({
  '/': 'test/e2e/fixture.html',
  '/frame.html': 'test/e2e/frame.html',
  '/harness.js': 'dist/test/harness.js',
  '/sample.webm': SAMPLE,
});
const { server: other, base: otherUrl } = await serve({ '/sample.webm': SAMPLE }, '127.0.0.1');
const crossUrl = `${otherUrl}sample.webm`;

const context = await browser.newContext({ viewport: { width: 1600, height: 5000 }, deviceScaleFactor: 2 });
const page = await context.newPage();
const errors = trackErrors(page, pageUrl);

await page.goto(`${pageUrl}?cross=${encodeURIComponent(crossUrl)}`);
await page.waitForFunction(() => document.body.dataset.drm !== undefined);
const drmSetup = await page.evaluate(() => document.body.dataset.drm);
await page.addScriptTag({ url: '/harness.js' });
const frame = page.frames().find((f) => f.url().endsWith('/frame.html'));
await frame.addScriptTag({ url: '/harness.js' });
await page.waitForTimeout(2500);

const debugIn = (target) => target.evaluate(() => Object.fromEntries(window.__videoUpscaler.status().map((d) => [d.id, d])));
const debug = () => debugIn(page);
/** Status code with detail, for the check messages. */
const why = (d) => (d ? `${d.code}${d.detail ? ` ${d.detail}` : ''}` : 'no session');

/** Corner of a video's content box (also inside the player's shadow root). */
const videoCorner = (target, id) => target.evaluate((id) => {
  const el = id === 'shadow'
    ? document.getElementById('shadow-host').shadowRoot.getElementById('shadow')
    : document.getElementById(id);
  const r = el.getBoundingClientRect();
  return { x: r.x + el.clientLeft, y: r.y + el.clientTop };
}, id);

async function checkAligned(target, id, content, d) {
  if (!d?.active) {
    expect(`${id}: active`, false, why(d));
    return;
  }
  const v = await videoCorner(target, id);
  const want = { x: v.x + content.x, y: v.y + content.y, width: content.width, height: content.height };
  const got = d.canvasRect;
  const off = Math.max(...['x', 'y', 'width', 'height'].map((k) => Math.abs(got[k] - want[k])));
  expect(`${id}: canvas aligned with the content`, off <= 1, `offset ${off.toFixed(2)} px, output ${d.output}`);
  expect(`${id}: frames drawn`, d.frames > 0, `${d.frames}`);
}

// Expected canvas rectangle: video position + border + content rectangle, computed here by
// hand (independently from src/core/geometry.ts).
const expected = {
  contain: { x: 0, y: 90, width: 960, height: 540 },
  cover: { x: (640 - (640 * SRC_W) / SRC_H) / 2, y: 0, width: (640 * SRC_W) / SRC_H, height: 640 },
  fill: { x: 0, y: 0, width: 800, height: 300 },
  fixed: { x: 0, y: 0, width: 480, height: 270 },
  late: { x: 0, y: 0, width: 640, height: 360 },
  ancestor: { x: 0, y: 0, width: 640, height: 360 },
  translated: { x: 0, y: 0, width: 640, height: 360 },
  position: { x: 0, y: 0, width: 960, height: 540 },
  shadow: { x: 0, y: 0, width: 640, height: 360 },
};

let state = await debug();
for (const [id, content] of Object.entries(expected)) await checkAligned(page, id, content, state[id]);
// Video inside an iframe: frame coordinates.
await checkAligned(frame, 'framed', { x: 0, y: 0, width: 640, height: 360 }, (await debugIn(frame)).framed);

const nativeWith = (id, code) => expect(`${id}: native (${code})`, !!state[id] && !state[id].active && state[id].code === code, why(state[id]));
nativeWith('small', 'not-needed');
nativeWith('cross', 'cross-origin');
nativeWith('scaled', 'transform');
nativeWith('offscreen', 'offscreen');
if (drmSetup === 'ok') nativeWith('drm', 'drm');
else note(`skip drm: ClearKey not available (${drmSetup})`);

// Cadence: one render per video frame.
const cadence = await page.evaluate(async () => {
  const v = document.getElementById('contain');
  const get = () => window.__videoUpscaler.status().find((d) => d.id === 'contain').frames;
  const f0 = get();
  const t0 = v.getVideoPlaybackQuality().totalVideoFrames;
  await new Promise((r) => setTimeout(r, 2000));
  return { render: get() - f0, video: v.getVideoPlaybackQuality().totalVideoFrames - t0 };
});
expect('render cadence ≈ video frames', cadence.video > 20 && cadence.render >= cadence.video * 0.9,
  `render ${cadence.render} / video ${cadence.video} in 2 s`);

// A/B comparison: stays active and keeps drawing.
await page.evaluate(() => window.__videoUpscaler.set({ compare: true }));
const framesBefore = (await debug()).contain.frames;
await page.waitForTimeout(600);
state = await debug();
expect('A/B comparison active', state.contain.active && state.contain.frames > framesBefore, why(state.contain));
await page.evaluate(() => window.__videoUpscaler.set({ compare: false }));

// Activation threshold: contain is ×3 (960 CSS px × dpr 2 / 640); with a ×4 threshold it goes native.
await page.evaluate(() => window.__videoUpscaler.set({ minScale: 4 }));
await page.waitForTimeout(300);
state = await debug();
expect('threshold ×4 → native', !state.contain.active && state.contain.code === 'not-needed' && state.contain.detail === '3.00', why(state.contain));
await page.evaluate(() => window.__videoUpscaler.set({ minScale: 1.05 }));
await page.waitForTimeout(300);
state = await debug();
expect('threshold ×1.05 → active again', state.contain.active, why(state.contain));

// Layout moved while the video is paused (no resize): realigned by the periodic check.
await page.evaluate(() => {
  document.getElementById('contain').pause();
  const spacer = Object.assign(document.createElement('div'), { id: 'spacer' });
  spacer.style.cssText = 'width: 100%; height: 37px';
  document.body.prepend(spacer);
});
await page.waitForTimeout(1300);
state = await debug();
await checkAligned(page, 'contain', expected.contain, state.contain);
await page.evaluate(() => {
  document.getElementById('spacer').remove();
  return document.getElementById('contain').play();
});

// Slow GPU: first a lighter algorithm, then the native video; changing quality tries again.
await page.evaluate(() => window.__videoUpscaler.degrade());
await page.waitForTimeout(200);
state = await debug();
expect('slow GPU → reduced to light quality', state.contain.active && state.contain.degraded && state.contain.quality === 'light',
  `${state.contain.quality}, ${why(state.contain)}`);
await page.evaluate(() => window.__videoUpscaler.degrade());
await page.waitForTimeout(200);
state = await debug();
expect('still slow → native', !state.contain.active && state.contain.code === 'gpu-slow', why(state.contain));
await page.evaluate(() => window.__videoUpscaler.set({ quality: 'light' }));
await page.waitForTimeout(300);
state = await debug();
expect('quality change → new attempt', state.contain.active && !state.contain.degraded && state.contain.quality === 'light',
  `${state.contain.quality}, ${why(state.contain)}`);
await page.evaluate(() => window.__videoUpscaler.set({ quality: 'high' }));

// Sharpness 0%: RCAS skipped, rendering continues.
await page.evaluate(() => window.__videoUpscaler.set({ sharpness: 0 }));
const framesSharp0 = (await debug()).contain.frames;
await page.waitForTimeout(600);
state = await debug();
expect('sharpness 0% → active without RCAS', state.contain.active && state.contain.frames > framesSharp0, why(state.contain));
await page.evaluate(() => window.__videoUpscaler.set({ sharpness: 87 }));

// Turning off and on again from the settings.
await page.evaluate(() => window.__videoUpscaler.set({ enabled: false }));
const canvases = await page.evaluate(() => document.querySelectorAll('canvas[data-video-upscaler]').length);
expect('off: no canvas left on the page', canvases === 0, `${canvases}`);
await page.evaluate(() => window.__videoUpscaler.set({ enabled: true, quality: 'light' }));
await page.waitForTimeout(500);
state = await debug();
expect('back on with another quality', state.contain?.active === true, why(state.contain));

// Source change: cross-origin error, then back to a readable source.
await page.evaluate((url) => {
  const v = document.getElementById('contain');
  v.src = url;
  return v.play();
}, crossUrl);
await page.waitForTimeout(1000);
state = await debug();
expect('source change → cross-origin goes native', !state.contain.active && state.contain.code === 'cross-origin', why(state.contain));
await page.evaluate(() => {
  const v = document.getElementById('contain');
  v.src = '/sample.webm';
  return v.play();
});
await page.waitForTimeout(1000);
state = await debug();
expect('readable source → active again', state.contain.active, why(state.contain));

// Incremental scan: a video nested in an added subtree and one in a new shadow root.
await page.evaluate(() => {
  const wrap = document.createElement('div');
  wrap.innerHTML = '<section><div class="player"><video id="nested" muted loop style="width:640px;height:360px"></video></div></section>';
  document.getElementById('ancestor-wrap').before(wrap);
  const nested = document.getElementById('nested');
  nested.src = '/sample.webm';
  const host = document.createElement('div');
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = '<video id="shadow-late" muted loop style="display:block;width:640px;height:360px"></video>';
  wrap.after(host);
  const sl = root.getElementById('shadow-late');
  sl.src = '/sample.webm';
  return Promise.all([nested.play(), sl.play()]);
});
await page.waitForTimeout(1200);
state = await debug();
expect('incremental scan: nested video', state.nested?.active === true, why(state.nested));
expect('incremental scan: new shadow root', state['shadow-late']?.active === true, why(state['shadow-late']));
await page.evaluate(() => {
  document.getElementById('nested').closest('div').parentElement.remove();
});

// Same element moved elsewhere (as React/Twitch do): the session stays.
const sessionBefore = (await debug()).late.session;
await page.evaluate(() => {
  const v = document.getElementById('late');
  const holder = document.createElement('div');
  holder.style.cssText = 'position: relative; padding: 10px';
  document.getElementById('contain').parentElement.before(holder);
  holder.append(v);
  return v.play();
});
await page.waitForTimeout(800);
state = await debug();
expect('video moved → same session', state.late?.session === sessionBefore, `#${sessionBefore} → #${state.late?.session}`);
await checkAligned(page, 'late', expected.late, state.late);

// Video removed: the session is closed (after the grace period) and the canvas removed.
await page.evaluate(() => document.getElementById('late').remove());
await page.waitForTimeout(1000);
state = await debug();
expect('video removed → session still in grace period', !!state.late && !state.late.active && state.late.code === 'removed', why(state.late));
await page.waitForTimeout(5500);
state = await debug();
expect('video removed → session closed after 5 s', !state.late);

await page.screenshot({ path: 'dist/e2e/fixture.png' });

// Off-screen video scrolled into view: becomes active.
await page.evaluate(() => document.getElementById('offscreen').scrollIntoView());
await page.waitForTimeout(600);
state = await debug();
expect('off screen → visible: active', state.offscreen?.active === true, why(state.offscreen));
if (errors.length) expect('no page errors', false, errors.join(' | '));

await finish(() => browser.close(), () => main.close(), () => other.close());
