/**
 * Calls `onFrame('frame')` for every new frame of a playing video and `onFrame('still')`
 * when the frame changes while the video is not playing (load, seek, pause).
 *
 * In Firefox, requestVideoFrameCallback and currentTime update at ~25 Hz even for 30/60 fps
 * videos (measured against the visible frame content), so they are not enough. During playback
 * we check on every rAF whether getVideoPlaybackQuality().totalVideoFrames has changed, which
 * tracks the visible frames almost exactly (about 0.2 missed per second out of 30).
 */
export class FrameLoop {
  private raf = 0;
  private lastFrames = -1;
  private running = false;

  constructor(
    private readonly video: HTMLVideoElement,
    private readonly onFrame: (kind: 'frame' | 'still') => void,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    for (const type of ['loadeddata', 'seeked', 'pause'] as const) {
      this.video.addEventListener(type, this.onStill);
    }
    this.video.addEventListener('play', this.onPlay);
    if (!this.video.paused) this.onPlay();
  }

  stop(): void {
    this.running = false;
    for (const type of ['loadeddata', 'seeked', 'pause'] as const) {
      this.video.removeEventListener(type, this.onStill);
    }
    this.video.removeEventListener('play', this.onPlay);
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private readonly onStill = () => this.onFrame('still');

  private readonly onPlay = () => {
    if (this.running && !this.raf) this.raf = requestAnimationFrame(this.tick);
  };

  private readonly tick = () => {
    this.raf = 0;
    const v = this.video;
    if (!this.running || v.paused || v.ended) return;
    const frames = v.getVideoPlaybackQuality().totalVideoFrames;
    if (frames !== this.lastFrames) {
      this.lastFrames = frames;
      this.onFrame('frame');
    }
    this.raf = requestAnimationFrame(this.tick);
  };
}
