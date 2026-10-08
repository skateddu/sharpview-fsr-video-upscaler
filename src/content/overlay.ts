import type { Layout } from './layout';

type Styles = Partial<Record<'position' | 'display' | 'left' | 'top' | 'width' | 'height' | 'clipPath' | 'zIndex', string>>;

/**
 * Elements laid over a <video>: the canvas the upscaler draws on and the info label. They sit
 * right after the video, in the same containing block.
 *
 * Styles are written only when they change: a write followed by reading the bounding rect
 * would force the browser to recompute layout on every frame.
 */
export class Overlay {
  private canvasEl = createCanvas();
  private readonly info = createInfo();
  /** Last written styles, per element. */
  private written = new WeakMap<HTMLElement, Styles>();
  /** Measured offset between computed and actual position (transformed ancestors, translate…). */
  private correction = { x: 0, y: 0 };

  get canvas(): HTMLCanvasElement {
    return this.canvasEl;
  }

  /** The canvas is visible on top of the video. */
  get shown(): boolean {
    return this.canvasEl.isConnected && this.written.get(this.canvasEl)?.display === '';
  }

  /**
   * Shows the canvas over the video's content and aligns it with what is measured on screen.
   * `origin`: corner of the content box in the containing block (or the viewport if fixed).
   * Returns the position of the visible corner, where the label goes.
   */
  show(video: HTMLVideoElement, layout: Layout, origin: Point, fixed: boolean, zIndex: string): Point {
    const { content, clip } = layout;
    const [ct, cr, cb, cl] = clip;
    this.attach(video);
    this.set(this.canvasEl, {
      display: '',
      position: fixed ? 'fixed' : 'absolute',
      width: `${content.width}px`,
      height: `${content.height}px`,
      clipPath: ct || cr || cb || cl ? `inset(${ct}px ${cr}px ${cb}px ${cl}px)` : '',
      zIndex,
    });
    const at = this.place(video, origin.x + content.x, origin.y + content.y, content.x, content.y);
    return { x: at.x + cl, y: at.y + ct };
  }

  hide(): void {
    this.set(this.canvasEl, { display: 'none' });
  }

  /** Label at a point of the containing block; null hides it. */
  label(video: HTMLVideoElement, text: string | null, at: Point, fixed: boolean): void {
    if (text === null) {
      this.set(this.info, { display: 'none' });
      return;
    }
    this.attach(video);
    this.set(this.info, {
      display: '',
      position: fixed ? 'fixed' : 'absolute',
      left: `${at.x + 8}px`,
      top: `${at.y + 8}px`,
    });
    if (this.info.textContent !== text) this.info.textContent = text;
  }

  /** `origin` adjusted by the measured offset (for the label while the canvas is hidden). */
  corrected(origin: Point): Point {
    return { x: origin.x + this.correction.x, y: origin.y + this.correction.y };
  }

  /** Replaces the canvas: once its WebGL context is released it cannot get another one. */
  replaceCanvas(): HTMLCanvasElement {
    const fresh = createCanvas();
    if (this.canvasEl.isConnected) this.canvasEl.replaceWith(fresh);
    this.canvasEl = fresh;
    return fresh;
  }

  remove(): void {
    this.canvasEl.remove();
    this.info.remove();
  }

  /** Canvas and label right after the video (put back if the page moved them). */
  private attach(video: HTMLVideoElement): void {
    if (this.canvasEl.previousElementSibling !== video || this.info.previousElementSibling !== this.canvasEl) {
      video.after(this.canvasEl, this.info);
    }
  }

  /** Positions the canvas and corrects the offset from the expected point on screen. */
  private place(video: HTMLVideoElement, left: number, top: number, contentX: number, contentY: number): Point {
    let x = left + this.correction.x;
    let y = top + this.correction.y;
    this.set(this.canvasEl, { left: `${x}px`, top: `${y}px` });
    const onScreen = videoOrigin(video, true);
    const cr = this.canvasEl.getBoundingClientRect();
    const dx = onScreen.x + contentX - cr.left;
    const dy = onScreen.y + contentY - cr.top;
    if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
      this.correction = { x: this.correction.x + dx, y: this.correction.y + dy };
      x += dx;
      y += dy;
      this.set(this.canvasEl, { left: `${x}px`, top: `${y}px` });
    }
    return { x, y };
  }

  private set(el: HTMLElement, styles: Styles): void {
    let last = this.written.get(el);
    if (!last) this.written.set(el, (last = {}));
    for (const [key, value] of Object.entries(styles) as [keyof Styles, string][]) {
      if (last[key] === value) continue;
      el.style[key] = value;
      last[key] = value;
    }
  }
}

export interface Point {
  x: number;
  y: number;
}

/** Corner of the video's content box: in the containing block, or the viewport if fixed. */
export function videoOrigin(v: HTMLVideoElement, fixed: boolean): Point {
  if (fixed) {
    const r = v.getBoundingClientRect();
    return { x: r.left + v.clientLeft, y: r.top + v.clientTop };
  }
  return { x: v.offsetLeft + v.clientLeft, y: v.offsetTop + v.clientTop };
}

function createCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.dataset.videoUpscaler = '';
  Object.assign(canvas.style, {
    position: 'absolute',
    display: 'none',
    pointerEvents: 'none',
    margin: '0',
    padding: '0',
    border: '0',
    transform: 'none',
  });
  return canvas;
}

function createInfo(): HTMLDivElement {
  const info = document.createElement('div');
  info.dataset.videoUpscaler = '';
  Object.assign(info.style, {
    position: 'absolute',
    display: 'none',
    pointerEvents: 'none',
    zIndex: '2147483647',
    padding: '2px 6px',
    font: '12px/1.4 monospace',
    color: '#fff',
    background: 'rgba(0,0,0,.6)',
    borderRadius: '3px',
  });
  return info;
}
