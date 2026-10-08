export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Rectangle of a <video>'s content relative to its box, following `object-fit` and
 * `object-position` (computed value, e.g. "50% 50%" or "10px 0%"). With cover/none it can
 * extend beyond the box.
 */
export function contentRect(
  objectFit: string,
  srcW: number,
  srcH: number,
  boxW: number,
  boxH: number,
  objectPosition = '50% 50%',
): Rect {
  let width: number;
  let height: number;
  switch (objectFit) {
    case 'fill':
      return { x: 0, y: 0, width: boxW, height: boxH };
    case 'cover': {
      const s = Math.max(boxW / srcW, boxH / srcH);
      width = srcW * s;
      height = srcH * s;
      break;
    }
    case 'none':
      width = srcW;
      height = srcH;
      break;
    case 'scale-down': {
      const s = Math.min(1, boxW / srcW, boxH / srcH);
      width = srcW * s;
      height = srcH * s;
      break;
    }
    default: {
      // contain, the default for <video>
      const s = Math.min(boxW / srcW, boxH / srcH);
      width = srcW * s;
      height = srcH * s;
    }
  }
  const [x, y] = objectOffset(objectPosition, boxW - width, boxH - height);
  return { x, y, width, height };
}

/**
 * Offset of the content from the computed object-position and the free space on each axis.
 * Supports percentages and px (the standard computed form); anything else (calc…) → center.
 */
function objectOffset(value: string, freeX: number, freeY: number): [number, number] {
  const parts = value.trim().split(/\s+/);
  const axis = (token: string, free: number) => {
    const m = parts.length === 2 ? /^(-?\d*\.?\d+)(px|%)$/.exec(token) : null;
    if (!m) return free / 2;
    const n = Number(m[1]);
    return m[2] === '%' ? (free * n) / 100 : n;
  };
  return [axis(parts[0], freeX), axis(parts[1] ?? '', freeY)];
}

/** Insets (top, right, bottom, left) to clip so that `content` stays inside the box. */
export function clipInsets(content: Rect, boxW: number, boxH: number): [number, number, number, number] {
  return [
    Math.max(0, -content.y),
    Math.max(0, content.x + content.width - boxW),
    Math.max(0, content.y + content.height - boxH),
    Math.max(0, -content.x),
  ];
}
