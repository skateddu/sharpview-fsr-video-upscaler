import { Upscaler, FrameLoop, type Quality, type RenderOptions } from '../core';
import { QUALITY_KEYS, toRenderOptions, type Settings } from '../shared/settings';
import { PERMANENT_CODES, describeStatus, type Status, type VideoStatus } from '../shared/status';
import { t } from '../shared/i18n';
import { log } from '../shared/log';
import { evaluateLayout, MIN_BOX, type Layout } from './layout';
import { Overlay, videoOrigin } from './overlay';
import { FpsMeter, PerfGovernor, type GpuBudget } from './perf';

/** How long a video must stay off screen before its WebGL context is released. */
const RELEASE_OFFSCREEN_MS = 10_000;
/**
 * Periodic re-check when not drawing every frame (video paused or not active): moves without
 * resizing, page zoom, a WebGL context becoming available again.
 */
const RECHECK_MS = 1000;

const ACTIVE: Status = { code: 'active' };

let nextSessionId = 1;

/**
 * Upscaling of a single <video>: a canvas laid over the content area, updated on every new
 * frame. When upscaling is not possible or not needed the canvas is hidden and the original
 * video stays visible; in that case the session is re-evaluated only when something can
 * change the outcome (size, visibility, settings, source) and once per second.
 */
export class VideoSession {
  /** Sequential number, to tell sessions apart in the logs. */
  readonly id = nextSessionId++;
  private readonly overlay = new Overlay();
  private readonly loop: FrameLoop;
  private readonly resizeObserver: ResizeObserver;
  private readonly intersectionObserver: IntersectionObserver;
  private readonly recheckTimer: number;
  private readonly meter = new FpsMeter();
  private readonly governor = new PerfGovernor();
  private upscaler: Upscaler | null = null;
  private status: Status = { code: 'waiting' };
  /** Permanent status for the current source (DRM, cross-origin, WebGL errors). */
  private failure: Status | null = null;
  private disposed = false;
  /** null until IntersectionObserver has answered. */
  private onScreen: boolean | null = null;
  private releaseTimer = 0;
  /** The GPU could not keep up: high quality reduced to light. */
  private degraded = false;
  /** Not even the lightest quality kept up: native video until the source or quality changes. */
  private gpuSlow = false;
  /** Rendering options for the settings and the effective quality. */
  private options: RenderOptions;
  private frames = 0;
  /** Measure the cost of the next frame (once per FpsMeter window). */
  private measureNext = true;
  /** Last measured cost: upload + draw until the GPU has completed it, in ms. */
  private frameCost = 0;

  constructor(
    readonly video: HTMLVideoElement,
    private settings: Settings,
    private readonly budget: GpuBudget,
  ) {
    this.options = toRenderOptions(settings);
    this.loop = new FrameLoop(video, this.onVideoFrame);
    this.resizeObserver = new ResizeObserver(this.update);
    this.resizeObserver.observe(video);
    this.intersectionObserver = new IntersectionObserver(this.onIntersection, { rootMargin: '100px' });
    this.intersectionObserver.observe(video);
    this.recheckTimer = window.setInterval(() => {
      if (this.video.paused || this.status.code !== 'active') this.update();
    }, RECHECK_MS);
    video.addEventListener('loadstart', this.onNewSource);
    video.addEventListener('emptied', this.onNewSource);
    video.addEventListener('resize', this.update);
    document.addEventListener('fullscreenchange', this.update);
    this.loop.start();
    this.update();
  }

  get active(): boolean {
    return this.status.code === 'active';
  }

  setSettings(settings: Settings): void {
    const qualityChanged = settings.quality !== this.settings.quality;
    this.settings = settings;
    if (qualityChanged) this.resetDegrade();
    this.options = toRenderOptions(settings, this.effectiveQuality());
    this.update();
  }

  dispose(): void {
    this.disposed = true;
    this.loop.stop();
    this.resizeObserver.disconnect();
    this.intersectionObserver.disconnect();
    clearInterval(this.recheckTimer);
    clearTimeout(this.releaseTimer);
    this.video.removeEventListener('loadstart', this.onNewSource);
    this.video.removeEventListener('emptied', this.onNewSource);
    this.video.removeEventListener('resize', this.update);
    document.removeEventListener('fullscreenchange', this.update);
    this.releaseGpu();
    this.overlay.remove();
  }

  /** Reduces the load by one step and re-evaluates (exposed for tests). */
  degrade(): void {
    this.stepDown();
    this.update();
  }

  /** Releases the GPU if the video is off screen (requested when the budget is full). */
  releaseIfOffscreen(): void {
    if (this.onScreen === false) this.releaseGpu();
  }

  snapshot(): VideoStatus {
    const v = this.video;
    const shown = this.overlay.shown;
    const r = shown ? this.overlay.canvas.getBoundingClientRect() : null;
    return {
      ...this.status,
      id: v.id,
      session: this.id,
      relevant: this.isRelevant(),
      active: shown,
      quality: this.effectiveQuality(),
      degraded: this.degraded || this.gpuSlow,
      fps: shown ? Math.round(this.meter.fps) : 0,
      videoFps: Math.round(this.meter.videoFps),
      input: `${v.videoWidth}×${v.videoHeight}`,
      output: `${this.overlay.canvas.width}×${this.overlay.canvas.height}`,
      canvasRect: r && { x: r.x, y: r.y, width: r.width, height: r.height },
      frames: this.frames,
    };
  }

  /** Real-size video (not a preview, tracker or hidden element). */
  private isRelevant(): boolean {
    const v = this.video;
    return v.isConnected && v.clientWidth >= MIN_BOX && v.clientHeight >= MIN_BOX;
  }

  private effectiveQuality(): Quality {
    return this.degraded ? 'light' : this.settings.quality;
  }

  /** Ladder: high → light → native video (GPU released). Takes effect from the next frame. */
  private stepDown(): void {
    this.governor.reset();
    if (!this.degraded && this.settings.quality === 'high') {
      this.degraded = true;
      this.options = toRenderOptions(this.settings, 'light');
    } else {
      this.gpuSlow = true;
      this.releaseGpu();
    }
  }

  private resetDegrade(): void {
    this.degraded = false;
    this.gpuSlow = false;
    this.governor.reset();
    this.options = toRenderOptions(this.settings);
  }

  private readonly onNewSource = () => {
    this.failure = null;
    this.meter.reset();
    this.resetDegrade();
    this.update();
  };

  /** New frames are drawn only while active; load, seek and pause are always evaluated. */
  private readonly onVideoFrame = (kind: 'frame' | 'still') => {
    if (kind === 'still' || this.active) this.update();
  };

  private readonly onIntersection = (entries: IntersectionObserverEntry[]) => {
    this.onScreen = entries[entries.length - 1].isIntersecting;
    clearTimeout(this.releaseTimer);
    // Off screen for a long time (feeds, video grids): release the WebGL context.
    if (!this.onScreen) this.releaseTimer = window.setTimeout(() => this.releaseGpu(), RELEASE_OFFSCREEN_MS);
    this.update();
  };

  /** Evaluates the status, draws the current frame if active, updates overlay and diagnostics. */
  private readonly update = () => {
    if (this.disposed) return;
    const status = this.render();
    if (status.code !== 'active') this.showNative(status);
    if (status.code !== this.status.code || status.detail !== this.status.detail) {
      const v = this.video;
      log(`#${this.id}`, status.code, status.detail ?? '', `${v.videoWidth}×${v.videoHeight}`, v.currentSrc.slice(0, 100));
      this.status = status;
    }
  };

  private render(): Status {
    const v = this.video;
    if (this.failure) return this.failure;
    if (this.gpuSlow) return { code: 'gpu-slow' };
    if (!v.isConnected) return { code: 'removed' };
    if (this.onScreen === null) return { code: 'waiting' };
    if (!this.onScreen) return { code: 'offscreen' };
    if (!v.videoWidth || !v.videoHeight) return { code: 'no-frame' };
    if (v.mediaKeys) return this.fail({ code: 'drm' });
    if (document.fullscreenElement === v) return { code: 'fullscreen-video' };

    const style = getComputedStyle(v);
    const result = evaluateLayout({
      videoWidth: v.videoWidth,
      videoHeight: v.videoHeight,
      boxWidth: v.clientWidth,
      boxHeight: v.clientHeight,
      display: style.display,
      visibility: style.visibility,
      transform: style.transform,
      objectFit: style.objectFit,
      objectPosition: style.objectPosition,
      devicePixelRatio,
      minScale: this.settings.minScale,
    });
    if (!result.ok) return result.status;

    const upscaler = this.acquireUpscaler();
    if (!(upscaler instanceof Upscaler)) return upscaler;

    const fixed = style.position === 'fixed';
    const corner = this.overlay.show(v, result.layout, videoOrigin(v, fixed), fixed, style.zIndex === 'auto' ? '' : style.zIndex);
    const error = this.draw(upscaler, result.layout);
    if (error) return error;

    this.frames++;
    this.updateStats();
    if (this.gpuSlow) return { code: 'gpu-slow' };
    this.overlay.label(v, this.settings.showInfo ? this.activeLabel(result.layout) : null, corner, fixed);
    return ACTIVE;
  }

  /** Upscaler ready to use, or the status preventing it. */
  private acquireUpscaler(): Upscaler | Status {
    if (!this.upscaler) {
      if (!this.budget.acquire(this)) return { code: 'budget' };
      try {
        this.upscaler = new Upscaler(this.overlay.canvas);
      } catch (e) {
        this.budget.release(this);
        return this.fail({ code: 'webgl-error', detail: errorText(e) });
      }
    }
    if (this.upscaler.contextLost) return { code: 'context-lost' };
    return this.upscaler;
  }

  /** Draws the current frame; returns the error status if it fails. */
  private draw(upscaler: Upscaler, layout: Layout): Status | null {
    const v = this.video;
    const canvas = this.overlay.canvas;
    const outW = Math.min(upscaler.maxSize, layout.outWidth);
    const outH = Math.min(upscaler.maxSize, layout.outHeight);
    if (canvas.width !== outW || canvas.height !== outH) {
      canvas.width = outW;
      canvas.height = outH;
    }
    try {
      const t0 = performance.now();
      upscaler.render(v, v.videoWidth, v.videoHeight, this.options);
      if (this.measureNext) {
        // Synchronous wait on the GPU once per window: the real cost of our work.
        upscaler.finish();
        this.frameCost = performance.now() - t0;
        this.measureNext = false;
      }
      return null;
    } catch (e) {
      // SecurityError: cross-origin frame without CORS, unreadable by WebGL. Checked by name:
      // in content scripts the exception may come from another compartment (instanceof fails).
      if ((e as { name?: unknown } | null)?.name === 'SecurityError') return this.fail({ code: 'cross-origin' });
      return this.fail({ code: 'render-error', detail: errorText(e) });
    }
  }

  private updateStats(): void {
    if (!this.meter.frame(performance.now(), this.videoFrames)) return;
    this.measureNext = true;
    if (this.video.paused || !this.governor.sample(this.meter.fps, this.meter.videoFps, this.frameCost)) return;
    log(
      `#${this.id} rendering cannot keep up, reducing the load:`,
      `${this.meter.fps.toFixed(0)}/${this.meter.videoFps.toFixed(0)} fps, ${this.frameCost.toFixed(1)} ms per frame`,
    );
    this.stepDown();
  }

  private readonly videoFrames = () => this.video.getVideoPlaybackQuality().totalVideoFrames;

  private activeLabel(layout: Layout): string {
    const v = this.video;
    const s = this.settings;
    const flags = [
      t(QUALITY_KEYS[this.effectiveQuality()].short),
      this.degraded ? t('labelReduced') : '',
      s.sharpness ? '' : t('labelNoSharpening'),
      s.compare ? 'A/B' : '',
    ].filter(Boolean);
    return (
      `${flags.join(' ')} · ${v.videoWidth}×${v.videoHeight} → ${this.overlay.canvas.width}×${this.overlay.canvas.height} · ` +
      `×${layout.scale.toFixed(2)} · ${this.meter.fps.toFixed(0)}/${this.meter.videoFps.toFixed(0)} fps`
    );
  }

  /** Original video visible; with info enabled the label explains why. */
  private showNative(status: Status): void {
    this.overlay.hide();
    const v = this.video;
    if (!this.settings.showInfo || !this.isRelevant()) {
      this.overlay.label(v, null, { x: 0, y: 0 }, false);
      return;
    }
    const fixed = getComputedStyle(v).position === 'fixed';
    const text = t('labelNative', describeStatus(status, t));
    this.overlay.label(v, text, this.overlay.corrected(videoOrigin(v, fixed)), fixed);
  }

  /** Releases the WebGL context and prepares a fresh canvas for next time. */
  private releaseGpu(): void {
    if (!this.upscaler) return;
    this.upscaler.dispose();
    this.upscaler = null;
    this.budget.release(this);
    this.overlay.replaceCanvas();
  }

  /** Permanent status for the current source: also releases the GPU. */
  private fail(status: Status): Status {
    if (!PERMANENT_CODES.has(status.code)) throw new Error(`not a permanent status: ${status.code}`);
    this.failure = status;
    this.releaseGpu();
    return status;
  }
}

function errorText(e: unknown): string {
  return e instanceof Error ? `${e.name}: ${e.message}` : String(e);
}
