// Pure logic for performance and GPU resources (tested with node --test, which runs
// TypeScript by stripping types only: no parameter properties in constructors).

/** Consecutive seconds below the threshold before the governor steps in. */
const STRIKE_LIMIT = 3;
/** Minimum share of the video's frames that rendering must reach. */
const MIN_RENDER_SHARE = 0.8;
/** Below this video fps (paused, buffering, slideshow) there is nothing to judge. */
const MIN_VIDEO_FPS = 10;
/** Share of the interval between frames beyond which our work counts as "heavy". */
const HEAVY_COST_SHARE = 0.5;

/**
 * Detects when upscaling cannot keep up with the video because of its own cost: rendering
 * stays below a share of the video's frames **and** the measured time to complete a frame on
 * the GPU takes a large part of the interval between frames, for several seconds in a row.
 * A drop in fps alone is not enough: it also happens when the window is covered or in the
 * background, as Firefox slows down repainting while the video keeps playing.
 * One sample per second.
 */
export class PerfGovernor {
  private strikes = 0;

  /**
   * Returns true when the load should be reduced.
   * @param frameCostMs time to upload and draw a frame until the GPU has completed it
   */
  sample(renderFps: number, videoFps: number, frameCostMs: number): boolean {
    if (videoFps < MIN_VIDEO_FPS) {
      this.strikes = 0;
      return false;
    }
    const lagging = renderFps < videoFps * MIN_RENDER_SHARE;
    const expensive = frameCostMs > (1000 / videoFps) * HEAVY_COST_SHARE;
    this.strikes = lagging && expensive ? this.strikes + 1 : 0;
    if (this.strikes < STRIKE_LIMIT) return false;
    this.strikes = 0;
    return true;
  }

  reset(): void {
    this.strikes = 0;
  }
}

/**
 * Limit on active WebGL contexts in a frame: Firefox keeps at most 16 per origin and, beyond
 * that, loses the oldest ones. When the budget is full, unused ones are asked to be released
 * (`reclaim`, e.g. off-screen videos) before refusing.
 */
export class GpuBudget {
  private readonly holders = new Set<object>();
  readonly max: number;
  reclaim: (() => void) | null = null;

  constructor(max = 12) {
    this.max = max;
  }

  acquire(holder: object): boolean {
    if (this.holders.has(holder)) return true;
    if (this.holders.size >= this.max) this.reclaim?.();
    if (this.holders.size >= this.max) return false;
    this.holders.add(holder);
    return true;
  }

  release(holder: object): void {
    this.holders.delete(holder);
  }

  get used(): number {
    return this.holders.size;
  }
}

/** Rendering and video frame rates, measured over windows of about one second. */
export class FpsMeter {
  fps = 0;
  videoFps = 0;
  private start = -1;
  private startVideoFrames = 0;
  private frames = 0;

  /**
   * Call for every drawn frame, with the time and a reader of the video's frame counter (read
   * only when a window opens or closes, not on every frame). Returns true when a window closes
   * and `fps`/`videoFps` are updated. The first call only sets the baseline: the video's
   * counter starts when the video was loaded, not when we started measuring.
   */
  frame(now: number, videoFrames: () => number): boolean {
    if (this.start < 0) {
      this.restart(now, videoFrames());
      return false;
    }
    this.frames++;
    const elapsed = now - this.start;
    if (elapsed < 1000) return false;
    const frames = videoFrames();
    this.fps = (this.frames * 1000) / elapsed;
    this.videoFps = ((frames - this.startVideoFrames) * 1000) / elapsed;
    this.restart(now, frames);
    return true;
  }

  /** New source or new session: start over. */
  reset(): void {
    this.start = -1;
    this.fps = 0;
    this.videoFps = 0;
  }

  private restart(now: number, videoFrames: number): void {
    this.start = now;
    this.startVideoFrames = videoFrames;
    this.frames = 0;
  }
}
