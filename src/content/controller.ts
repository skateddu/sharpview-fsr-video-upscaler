import { VideoSession } from './session';
import { GpuBudget } from './perf';
import { log } from '../shared/log';
import type { Settings } from '../shared/settings';
import type { VideoStatus } from '../shared/status';

/** Delay used to batch DOM mutations before examining them. */
const SCAN_DELAY_MS = 250;
/**
 * A video detached from the page is closed only if it stays detached this long: frameworks
 * (React, Twitch…) often move the same element, and closing the session would mean throwing
 * away and recreating its WebGL context every time.
 */
const DETACH_GRACE_MS = 5000;
/**
 * Periodic full scan, as a safety net: the incremental scan only looks at added nodes and can
 * miss, for example, a shadow root created after its host was inserted.
 */
const FULL_SCAN_MS = 10_000;

/**
 * Finds the page's <video> elements, including inside shadow roots, and manages one
 * VideoSession for each. After the initial scan it only examines added nodes: on pages that
 * change all the time (chat, comments) re-reading the whole DOM would cost CPU for as long as
 * the video plays.
 */
export class Controller {
  private readonly sessions = new Map<HTMLVideoElement, VideoSession>();
  private readonly observer = new MutationObserver((records) => this.onMutations(records));
  /** Roots observed by the MutationObserver since the last start (disconnect forgets them all). */
  private observedRoots = new WeakSet<Node>();
  private readonly budget = new GpuBudget();
  /** Added nodes to examine at the next scan. */
  private readonly added = new Set<Element>();
  /** Videos detached from the page → when they were first seen detached. */
  private readonly detached = new Map<HTMLVideoElement, number>();
  private settings: Settings | null = null;
  private running = false;
  private removalsPending = false;
  private scanTimer = 0;
  private graceTimer = 0;
  private fullScanTimer = 0;

  constructor() {
    this.budget.reclaim = () => {
      for (const s of this.sessions.values()) s.releaseIfOffscreen();
    };
  }

  /** `active`: master switch and per-site rules, already combined by the caller. */
  setSettings(settings: Settings, active: boolean): void {
    this.settings = settings;
    if (active && !this.running) {
      log('controller started', location.host);
      this.start();
    } else if (!active && this.running) {
      log('controller stopped', location.host, settings.enabled ? '(site excluded)' : '(turned off)');
      this.stop();
    } else {
      for (const s of this.sessions.values()) s.setSettings(settings);
    }
  }

  snapshot(): VideoStatus[] {
    return [...this.sessions.values()].map((s) => s.snapshot());
  }

  /** Tests only: simulates a GPU that cannot keep up. */
  degradeAll(): void {
    for (const s of this.sessions.values()) s.degrade();
  }

  private start(): void {
    this.running = true;
    this.observe(document.documentElement);
    this.fullScan();
    this.fullScanTimer = window.setInterval(() => this.fullScan(), FULL_SCAN_MS);
  }

  private stop(): void {
    this.running = false;
    this.observer.disconnect();
    this.observedRoots = new WeakSet();
    clearTimeout(this.scanTimer);
    clearTimeout(this.graceTimer);
    clearInterval(this.fullScanTimer);
    this.scanTimer = this.graceTimer = this.fullScanTimer = 0;
    for (const s of this.sessions.values()) s.dispose();
    this.sessions.clear();
    this.detached.clear();
    this.added.clear();
  }

  private observe(root: Node): void {
    if (this.observedRoots.has(root)) return;
    this.observedRoots.add(root);
    this.observer.observe(root, { childList: true, subtree: true });
  }

  private onMutations(records: MutationRecord[]): void {
    for (const r of records) {
      for (const node of r.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE && !(node as HTMLElement).dataset?.videoUpscaler) {
          this.added.add(node as Element);
        }
      }
      if (r.removedNodes.length) this.removalsPending = true;
    }
    if (this.added.size || this.removalsPending) this.scheduleScan();
  }

  private scheduleScan(): void {
    if (this.scanTimer) return;
    this.scanTimer = window.setTimeout(() => {
      this.scanTimer = 0;
      this.incrementalScan();
    }, SCAN_DELAY_MS);
  }

  private fullScan(): void {
    if (!this.running) return;
    this.added.clear();
    this.checkDetached();
    this.adopt(this.findVideos([document]));
  }

  private incrementalScan(): void {
    if (!this.running) return;
    if (this.removalsPending || this.detached.size) this.checkDetached();
    this.removalsPending = false;
    // Roots inside another added root would be scanned twice.
    const roots = [...this.added].filter((el) => el.isConnected && !hasAddedAncestor(el, this.added));
    this.added.clear();
    if (roots.length) this.adopt(this.findVideos(roots));
  }

  /** Creates sessions for new videos. */
  private adopt(videos: Iterable<HTMLVideoElement>): void {
    if (!this.settings) return;
    for (const video of videos) {
      if (!this.sessions.has(video)) this.sessions.set(video, new VideoSession(video, this.settings, this.budget));
    }
  }

  /** Closes the sessions of videos detached from the page for longer than the grace period. */
  private checkDetached(): void {
    const now = performance.now();
    for (const [video, session] of this.sessions) {
      if (video.isConnected) {
        this.detached.delete(video);
        continue;
      }
      const since = this.detached.get(video);
      if (since === undefined) {
        this.detached.set(video, now);
      } else if (now - since >= DETACH_GRACE_MS) {
        log(`#${session.id} video removed from the page, session closed`);
        session.dispose();
        this.sessions.delete(video);
        this.detached.delete(video);
      }
    }
    // Re-check detached videos even if the DOM stops changing.
    if (this.detached.size && !this.graceTimer) {
      this.graceTimer = window.setTimeout(() => {
        this.graceTimer = 0;
        if (this.running) this.checkDetached();
      }, DETACH_GRACE_MS);
    }
  }

  /** Videos inside the given roots and their shadow roots (closed ones too, where Firefox allows). */
  private findVideos(roots: (Document | ShadowRoot | Element)[]): Set<HTMLVideoElement> {
    const videos = new Set<HTMLVideoElement>();
    const queue = [...roots];
    while (queue.length) {
      const root = queue.pop()!;
      // localName/nodeType instead of instanceof: more reliable between page and content script.
      const visit = (el: Element) => {
        if (el.localName === 'video') videos.add(el as HTMLVideoElement);
        const shadow = shadowRootOf(el);
        if (shadow) {
          queue.push(shadow);
          this.observe(shadow);
        }
      };
      if (root.nodeType === Node.ELEMENT_NODE) visit(root as Element);
      for (const el of root.querySelectorAll('*')) visit(el);
    }
    return videos;
  }
}

function hasAddedAncestor(el: Element, added: ReadonlySet<Element>): boolean {
  for (let p = el.parentElement; p; p = p.parentElement) if (added.has(p)) return true;
  return false;
}

/** openOrClosedShadowRoot exists only in Firefox content scripts; elsewhere, open roots only. */
function shadowRootOf(el: Element): ShadowRoot | null {
  return (el as Element & { openOrClosedShadowRoot?: ShadowRoot | null }).openOrClosedShadowRoot ?? el.shadowRoot;
}
