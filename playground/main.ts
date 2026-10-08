import { Upscaler, FrameLoop, DEFAULT_OPTIONS, UPSCALE_MODES, type RenderOptions, type UpscaleMode } from '../src/core';
import { contentRect } from '../src/core/geometry';
import { byId as $ } from '../src/shared/dom';
import { makeTestPattern } from './pattern';

const MODE_LABELS: Record<UpscaleMode, string> = {
  fsr: 'FSR1 (EASU + RCAS)',
  easu: 'EASU only',
  'bilinear-rcas': 'Bilinear + RCAS',
  bilinear: 'Bilinear',
};

const video = $<HTMLVideoElement>('video');
const canvas = $<HTMLCanvasElement>('canvas');
const viewport = $<HTMLDivElement>('viewport');
const stage = $<HTMLElement>('stage');
const placeholder = $<HTMLElement>('placeholder');
const fileInput = $<HTMLInputElement>('file');
const urlInput = $<HTMLInputElement>('url');
const playBtn = $<HTMLButtonElement>('play');
const seek = $<HTMLInputElement>('seek');
const timeLabel = $<HTMLSpanElement>('time');
const modeSel = $<HTMLSelectElement>('mode');
const outputSel = $<HTMLSelectElement>('output');
const sharpness = $<HTMLInputElement>('sharpness');
const sharpnessVal = $<HTMLOutputElement>('sharpness-val');
const denoise = $<HTMLInputElement>('denoise');
const viewSel = $<HTMLSelectElement>('view');
const compare = $<HTMLInputElement>('compare');
const split = $<HTMLInputElement>('split');
const zoomSel = $<HTMLSelectElement>('zoom');
const benchBtn = $<HTMLButtonElement>('bench');
const statsEl = $<HTMLPreElement>('stats');
const benchEl = $<HTMLPreElement>('bench-result');
const statusEl = $<HTMLParagraphElement>('status');

UPSCALE_MODES.forEach((mode, i) => modeSel.add(new Option(`${i + 1} · ${MODE_LABELS[mode]}`, mode)));

interface Source {
  el: HTMLVideoElement | HTMLCanvasElement;
  width: number;
  height: number;
}

const pattern = makeTestPattern();
pattern.className = 'pattern-native';

let upscaler: Upscaler;
let source: Source | null = null;
let objectUrl: string | null = null;
let framesRendered = 0;

const opts: RenderOptions = { ...DEFAULT_OPTIONS };

function setStatus(text: string, isError = false): void {
  statusEl.textContent = text;
  statusEl.classList.toggle('error', isError);
  document.body.dataset.status = isError ? 'error' : 'ok';
}

function readControls(): void {
  opts.mode = modeSel.value as UpscaleMode;
  opts.sharpness = Number(sharpness.value);
  opts.denoise = denoise.checked;
  opts.split = compare.checked ? Number(split.value) : -1;
  sharpnessVal.textContent = opts.sharpness > 0 ? `${sharpness.value}%` : 'off';
  viewport.classList.toggle('native', viewSel.value === 'native');
}

function outputSize(src: Source): [number, number] {
  const v = outputSel.value;
  if (v === 'fit') {
    const dpr = devicePixelRatio;
    const r = contentRect('contain', src.width, src.height, stage.clientWidth * dpr, stage.clientHeight * dpr);
    return [Math.round(r.width), Math.round(r.height)];
  }
  if (v.startsWith('x')) {
    const k = Number(v.slice(1));
    return [Math.round(src.width * k), Math.round(src.height * k)];
  }
  const h = Number(v.slice(1));
  return [Math.round((h * src.width) / src.height), h];
}

function layout(src: Source): void {
  const [w, h] = outputSize(src);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const zoom = Number(zoomSel.value);
  viewport.style.width = `${(w / devicePixelRatio) * zoom}px`;
  viewport.style.height = `${(h / devicePixelRatio) * zoom}px`;
}

function draw(): void {
  if (!source) return;
  layout(source);
  try {
    upscaler.render(source.el, source.width, source.height, opts);
    framesRendered++;
    if (document.body.dataset.status !== 'ok') setStatus('Rendering OK');
  } catch (e) {
    setStatus(`Rendering error: ${(e as Error).message}`, true);
  }
}

let drawPending = false;
function requestDraw(): void {
  if (drawPending) return;
  drawPending = true;
  requestAnimationFrame(() => {
    drawPending = false;
    draw();
  });
}

// One render per new video frame (and on load, seek and pause).
new FrameLoop(video, () => {
  if (source?.el === video) draw();
}).start();

function setSource(src: Source): void {
  source = src;
  placeholder.hidden = true;
  viewport.hidden = false;
  video.hidden = src.el !== video;
  if (src.el === pattern) viewport.append(pattern);
  else pattern.remove();
  const isVideo = src.el === video;
  playBtn.disabled = seek.disabled = !isVideo;
  benchBtn.disabled = false;
  benchEl.textContent = '';
  requestDraw();
}

function loadVideo(url: string, crossOrigin: boolean): void {
  if (objectUrl && objectUrl !== url) URL.revokeObjectURL(objectUrl);
  video.crossOrigin = crossOrigin ? 'anonymous' : null;
  video.src = url;
  video.load();
  setStatus('Loading…');
}

function loadFile(file: File): void {
  const url = URL.createObjectURL(file);
  loadVideo(url, false);
  objectUrl = url;
}

function loadPattern(): void {
  video.pause();
  setSource({ el: pattern, width: pattern.width, height: pattern.height });
}

function formatTime(t: number): string {
  const s = Math.floor(t % 60).toString().padStart(2, '0');
  return `${Math.floor(t / 60)}:${s}`;
}

// --- Video events ---

video.addEventListener('loadedmetadata', () => {
  setSource({ el: video, width: video.videoWidth, height: video.videoHeight });
  setStatus(`Video loaded: ${video.videoWidth}×${video.videoHeight}`);
});
video.addEventListener('error', () => {
  setStatus('Cannot load the video (unsupported format or missing CORS).', true);
});
video.addEventListener('play', () => (playBtn.textContent = '❚❚'));
video.addEventListener('pause', () => (playBtn.textContent = '▶'));
video.addEventListener('timeupdate', () => {
  if (video.duration) seek.value = String((video.currentTime / video.duration) * 1000);
  timeLabel.textContent = formatTime(video.currentTime);
});

// --- Controls ---

fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  if (file) loadFile(file);
});
$('pattern').addEventListener('click', loadPattern);
$('load-url').addEventListener('click', () => {
  if (urlInput.value) loadVideo(urlInput.value, true);
});
playBtn.addEventListener('click', () => (video.paused ? video.play() : video.pause()));
seek.addEventListener('input', () => {
  if (video.duration) video.currentTime = (Number(seek.value) / 1000) * video.duration;
});

for (const el of [modeSel, outputSel, sharpness, denoise, viewSel, compare, split, zoomSel]) {
  el.addEventListener('input', () => {
    readControls();
    requestDraw();
  });
}
new ResizeObserver(requestDraw).observe(stage);

// Dragging on the canvas moves the split.
canvas.addEventListener('pointermove', (e) => {
  if (!(e.buttons & 1)) return;
  const r = canvas.getBoundingClientRect();
  split.value = String(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)));
  compare.checked = true;
  readControls();
  requestDraw();
});

document.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement && e.target.type === 'url') return;
  const n = Number(e.key);
  if (n >= 1 && n <= UPSCALE_MODES.length) {
    modeSel.value = UPSCALE_MODES[n - 1];
  } else if (e.key === 'c' || e.key === 'C') {
    compare.checked = !compare.checked;
  } else if (e.key === 'n' || e.key === 'N') {
    viewSel.value = viewSel.value === 'native' ? 'canvas' : 'native';
  } else if (e.key === ' ' && source?.el === video) {
    e.preventDefault();
    if (video.paused) video.play();
    else video.pause();
  } else {
    return;
  }
  readControls();
  requestDraw();
});

document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => {
  e.preventDefault();
  const file = e.dataTransfer?.files[0];
  if (file) loadFile(file);
});

// --- Benchmark and stats ---

benchBtn.addEventListener('click', () => {
  if (!source) return;
  const src = source;
  layout(src);
  const lines = [`Benchmark at ${canvas.width}×${canvas.height} (upload included):`];
  for (const mode of UPSCALE_MODES) {
    const ms = upscaler.benchmark(src.el, src.width, src.height, { ...opts, mode, split: -1 });
    lines.push(`  ${mode.padEnd(14)} ${ms.toFixed(2).padStart(6)} ms  (~${Math.round(1000 / ms)} fps)`);
  }
  benchEl.textContent = lines.join('\n');
  requestDraw();
});

let lastStatsTime = performance.now();
let lastStatsFrames = 0;
let lastStatsVideoFrames = 0;
setInterval(() => {
  const now = performance.now();
  const q = video.getVideoPlaybackQuality();
  const fps = ((framesRendered - lastStatsFrames) * 1000) / (now - lastStatsTime);
  const videoFps = ((q.totalVideoFrames - lastStatsVideoFrames) * 1000) / (now - lastStatsTime);
  lastStatsTime = now;
  lastStatsFrames = framesRendered;
  lastStatsVideoFrames = q.totalVideoFrames;

  const lines = [`GPU (masked by Firefox): ${upscaler.rendererName}`];
  if (source) {
    const scale = canvas.width / source.width;
    lines.push(
      `Input: ${source.width}×${source.height}`,
      `Output: ${canvas.width}×${canvas.height} (×${scale.toFixed(2)})`,
      `Render: ${fps.toFixed(1)} fps`,
    );
    if (source.el === video) {
      lines.push(
        `Video: ${videoFps.toFixed(1)} fps`,
        `Dropped frames: ${q.droppedVideoFrames} / ${q.totalVideoFrames}`,
      );
    }
  }
  statsEl.textContent = lines.join('\n');
}, 500);

// --- Startup ---

try {
  upscaler = new Upscaler(canvas);
} catch (e) {
  setStatus(`Initialization failed: ${(e as Error).message}`, true);
  throw e;
}

// URL parameters for automated tests, e.g. ?pattern&mode=fsr&out=x3&split=0.5
const params = new URLSearchParams(location.search);
if (params.has('mode')) modeSel.value = params.get('mode')!;
if (params.has('out')) outputSel.value = params.get('out')!;
if (params.has('split')) {
  compare.checked = true;
  split.value = params.get('split')!;
}
readControls();
if (params.has('pattern')) {
  loadPattern();
  draw();
}

// Hook for automated tests (scripts/render-test.mjs).
(window as unknown as { __playground: unknown }).__playground = { draw, canvas, upscaler: () => upscaler };
