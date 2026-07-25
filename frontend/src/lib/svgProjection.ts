/**
 * SVG viewBox ↔ WGS84 (EPSG:4326)
 * backend/map/build_admin_layers.py · geocode_mountains_kakao.py 와 동일 파라미터
 */
import proj4 from "proj4";

const XMIN = 740000.0;
const YMIN = 1450000.0;
const XMAX = 1395000.0;
const YMAX = 2075000.0;
const WIDTH = 800;
const HEIGHT = 900;
const PAD = 24;

/** Korea 2000 / Unified CS (EPSG:5179) */
const EPSG_5179 =
  "+proj=tmerc +lat_0=38 +lon_0=127.5 +k=0.9996 +x_0=1000000 +y_0=2000000 +ellps=GRS80 +units=m +no_defs";

proj4.defs("EPSG:5179", EPSG_5179);

export type LatLng = { lat: number; lng: number };
export type SvgView = { scale: number; tx: number; ty: number };

const INNER_W = WIDTH - 2 * PAD;
const INNER_H = HEIGHT - 2 * PAD;

export function svgToTm(sx: number, sy: number): [number, number] {
  const tmX = XMIN + ((sx - PAD) / INNER_W) * (XMAX - XMIN);
  const tmY = YMAX - ((sy - PAD) / INNER_H) * (YMAX - YMIN);
  return [tmX, tmY];
}

export function tmToSvg(tmX: number, tmY: number): [number, number] {
  const sx = PAD + ((tmX - XMIN) / (XMAX - XMIN)) * INNER_W;
  const sy = PAD + ((YMAX - tmY) / (YMAX - YMIN)) * INNER_H;
  return [sx, sy];
}

export function svgToWgs84(sx: number, sy: number): LatLng {
  const [tmX, tmY] = svgToTm(sx, sy);
  const [lng, lat] = proj4("EPSG:5179", "WGS84", [tmX, tmY]) as [
    number,
    number,
  ];
  return { lat, lng };
}

export function wgs84ToSvg(lat: number, lng: number): [number, number] {
  const [tmX, tmY] = proj4("WGS84", "EPSG:5179", [lng, lat]) as [
    number,
    number,
  ];
  return tmToSvg(tmX, tmY);
}

/** SVG path `d` (M/L/Z absolute) → SVG 좌표 링 목록 */
export function svgPathToRings(d: string): [number, number][][] {
  const rings: [number, number][][] = [];
  let ring: [number, number][] = [];
  const re = /([MLZmlz])([^MLZmlz]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(d))) {
    const cmd = m[1].toUpperCase();
    if (cmd === "Z") {
      if (ring.length >= 3) rings.push(ring);
      ring = [];
      continue;
    }
    const raw = m[2].trim();
    if (!raw) continue;
    const nums = raw
      .split(/[\s,]+/)
      .map(Number)
      .filter((n) => Number.isFinite(n));
    for (let i = 0; i + 1 < nums.length; i += 2) {
      ring.push([nums[i], nums[i + 1]]);
    }
  }
  if (ring.length >= 3) rings.push(ring);
  return rings;
}

export function svgPathToLatLngRings(d: string): LatLng[][] {
  return svgPathToRings(d).map((ring) =>
    ring.map(([x, y]) => svgToWgs84(x, y)),
  );
}

/** 변환된 view 의 화면 중심 (viewBox 좌표계 기준 SVG 콘텐츠 점) */
export function viewCenterSvg(
  view: SvgView,
  vbW = WIDTH,
  vbH = HEIGHT,
): [number, number] {
  return [(vbW / 2 - view.tx) / view.scale, (vbH / 2 - view.ty) / view.scale];
}

export function viewFromCenterSvg(
  cx: number,
  cy: number,
  scale: number,
  vbW = WIDTH,
  vbH = HEIGHT,
): SvgView {
  return {
    scale,
    tx: vbW / 2 - cx * scale,
    ty: vbH / 2 - cy * scale,
  };
}

/**
 * SVG scale ↔ 카카오 지도 level (1=최대확대, 14=전국)
 * scale 1 ≈ 전국, scale↑ ≈ 확대
 */
export function scaleToKakaoLevel(scale: number): number {
  const s = Math.max(1, scale);
  const level = Math.round(14 - 2.15 * Math.log2(s));
  return Math.min(13, Math.max(3, level));
}

export function kakaoLevelToScale(level: number): number {
  const lv = Math.min(14, Math.max(1, level));
  return Math.pow(2, (14 - lv) / 2.15);
}

export function svgViewToKakao(
  view: SvgView,
  vbW = WIDTH,
  vbH = HEIGHT,
): { center: LatLng; level: number } {
  const [cx, cy] = viewCenterSvg(view, vbW, vbH);
  return {
    center: svgToWgs84(cx, cy),
    level: scaleToKakaoLevel(view.scale),
  };
}

export function kakaoToSvgView(
  center: LatLng,
  level: number,
  vbW = WIDTH,
  vbH = HEIGHT,
): SvgView {
  const [cx, cy] = wgs84ToSvg(center.lat, center.lng);
  return viewFromCenterSvg(cx, cy, kakaoLevelToScale(level), vbW, vbH);
}

export const SVG_VIEWBOX: [number, number] = [WIDTH, HEIGHT];
