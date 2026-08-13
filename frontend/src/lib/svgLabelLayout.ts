/** SVG path 링에서 라벨 위치(육지 안쪽)와 글자 크기를 계산한다. */

export type Pt = [number, number];

const centerCache = new Map<string, Pt>();
const ringCache = new Map<string, Pt[] | null>();

export function parsePathRings(d: string): Pt[][] {
  const rings: Pt[][] = [];
  for (const part of d.split(/[Zz]/)) {
    const nums = part.match(/-?\d*\.?\d+/g);
    if (!nums || nums.length < 6) continue;
    const ring: Pt[] = [];
    for (let i = 0; i + 1 < nums.length; i += 2) {
      const x = Number(nums[i]);
      const y = Number(nums[i + 1]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      ring.push([x, y]);
    }
    if (ring.length >= 3) rings.push(ring);
  }
  return rings;
}

function signedArea(ring: Pt[]): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  }
  return a / 2;
}

export function largestRing(d: string, cacheKey?: string): Pt[] | null {
  if (cacheKey && ringCache.has(cacheKey)) return ringCache.get(cacheKey)!;
  const rings = parsePathRings(d);
  if (!rings.length) {
    if (cacheKey) ringCache.set(cacheKey, null);
    return null;
  }
  let best = rings[0];
  let bestA = -1;
  for (const ring of rings) {
    const a = Math.abs(signedArea(ring));
    if (a > bestA) {
      bestA = a;
      best = ring;
    }
  }
  if (cacheKey) ringCache.set(cacheKey, best);
  return best;
}

export function ringBBox(ring: Pt[]): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of ring) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

function areaCentroid(ring: Pt[]): Pt {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const cross = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
    a += cross;
    cx += (ring[j][0] + ring[i][0]) * cross;
    cy += (ring[j][1] + ring[i][1]) * cross;
  }
  if (Math.abs(a) < 1e-8) {
    let sx = 0;
    let sy = 0;
    for (const [x, y] of ring) {
      sx += x;
      sy += y;
    }
    return [sx / ring.length, sy / ring.length];
  }
  return [cx / (3 * a), cy / (3 * a)];
}

function pointInRing(p: Pt, ring: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi || 1e-12) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function sqSegDist(p: Pt, a: Pt, b: Pt): number {
  let x = a[0];
  let y = a[1];
  const dx = b[0] - x;
  const dy = b[1] - y;
  if (dx !== 0 || dy !== 0) {
    const t = ((p[0] - x) * dx + (p[1] - y) * dy) / (dx * dx + dy * dy);
    if (t > 1) {
      x = b[0];
      y = b[1];
    } else if (t > 0) {
      x += dx * t;
      y += dy * t;
    }
  }
  const ex = p[0] - x;
  const ey = p[1] - y;
  return ex * ex + ey * ey;
}

function distToRing(p: Pt, ring: Pt[]): number {
  let min = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const d = sqSegDist(p, ring[j], ring[i]);
    if (d < min) min = d;
  }
  const s = Math.sqrt(min);
  return pointInRing(p, ring) ? s : -s;
}

/** 폴리곤 안쪽에서 경계까지 가장 먼 점 (pole of inaccessibility). */
function polylabel(ring: Pt[], precision = 0.45): Pt {
  const bb = ringBBox(ring);
  const width = bb.maxX - bb.minX;
  const height = bb.maxY - bb.minY;
  const cellSize = Math.min(width, height);
  if (!(cellSize > 0)) {
    return [(bb.minX + bb.maxX) / 2, (bb.minY + bb.maxY) / 2];
  }

  type Cell = { x: number; y: number; h: number; d: number; max: number };
  const makeCell = (x: number, y: number, h: number): Cell => {
    const d = distToRing([x, y], ring);
    return { x, y, h, d, max: d + h * Math.SQRT2 };
  };

  const cells: Cell[] = [];
  const h0 = cellSize / 2;
  for (let x = bb.minX; x < bb.maxX; x += cellSize) {
    for (let y = bb.minY; y < bb.maxY; y += cellSize) {
      cells.push(makeCell(x + h0, y + h0, h0));
    }
  }

  const [cx, cy] = areaCentroid(ring);
  let best = makeCell(cx, cy, 0);
  const mid = makeCell((bb.minX + bb.maxX) / 2, (bb.minY + bb.maxY) / 2, 0);
  if (mid.d > best.d) best = mid;

  let guard = 0;
  while (cells.length && guard++ < 280) {
    let bi = 0;
    for (let i = 1; i < cells.length; i++) {
      if (cells[i].max > cells[bi].max) bi = i;
    }
    const cell = cells.splice(bi, 1)[0];
    if (cell.d > best.d) best = cell;
    if (cell.max - best.d <= precision) continue;
    const nh = cell.h / 2;
    if (nh < precision * 0.5) continue;
    cells.push(
      makeCell(cell.x - nh, cell.y - nh, nh),
      makeCell(cell.x + nh, cell.y - nh, nh),
      makeCell(cell.x - nh, cell.y + nh, nh),
      makeCell(cell.x + nh, cell.y + nh, nh),
    );
  }
  return [best.x, best.y];
}

export function visualCenterFromPath(d: string, cacheKey?: string): Pt | null {
  const key = cacheKey ?? d;
  const cached = centerCache.get(key);
  if (cached) return cached;
  const ring = largestRing(d, cacheKey);
  if (!ring) return null;
  const pt = polylabel(ring);
  centerCache.set(key, pt);
  return pt;
}

export function labelCharWidth(text: string): number {
  let w = 0;
  for (const ch of text) w += ch === " " ? 0.35 : 1;
  return Math.max(w, 1);
}

/**
 * 양평군(minDim ≈ 46) 비율을 기준으로, 가장 큰 링 안에 글자가 들어가게 맞춤.
 */
export function fontSizeForRing(
  ring: Pt[] | null,
  text: string,
  zoomFs: number,
): number {
  if (!ring) return zoomFs;
  const bb = ringBBox(ring);
  const w = Math.max(bb.maxX - bb.minX, 1);
  const h = Math.max(bb.maxY - bb.minY, 1);
  const minDim = Math.min(w, h);
  const REF_MIN = 46;
  const sizeFactor = Math.min(1.1, Math.max(0.28, minDim / REF_MIN));
  let fs = zoomFs * sizeFactor;
  const charW = labelCharWidth(text);
  fs = Math.min(fs, (w * 0.56) / charW, h * 0.3);
  return Math.max(fs, zoomFs * 0.28);
}
