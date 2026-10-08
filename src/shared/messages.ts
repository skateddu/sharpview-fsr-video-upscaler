import type { VideoStatus } from './status';

/** Messages between content scripts, background and popup. */
export type Message =
  /** content → background: hostname of the tab (also from inside iframes). */
  | { type: 'get-site' }
  /** popup → content: state of the frame's videos. */
  | { type: 'status' };

export interface FrameStatus {
  frame: string;
  videos: VideoStatus[];
}
