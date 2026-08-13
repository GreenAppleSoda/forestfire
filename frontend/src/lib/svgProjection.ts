/**
 * SVG viewBox ??WGS84 (EPSG:4326)
 * etl/map/build_admin_layers.py 쨌 geocode_mountains_kakao.py ? ?숈씪 ?뚮씪誘명꽣
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

/** SVG path `d` (M/L/Z absolute) ??SVG 醫뚰몴 留?紐⑸줉 */
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

/** 蹂?섎맂 view ???붾㈃ 以묒떖 (viewBox 醫뚰몴怨?湲곗? SVG 肄섑뀗痢??? */
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
 * SVG scale ↔ 카카오 지도 level
 * - 카카오: level 작을수록 확대 (1=최대 확대, 13=전국)
 * - SVG scale 1(전국) ≈ 카카오 level 13 (뷰포트에 한국이 비슷하게 차는 수준)
 * - scale×2 ≈ Kakao level -1 (웹맵 표준 2배 줌)
 */
const KAKAO_LEVEL_AT_SCALE_1 = 13;
const LEVELS_PER_SCALE_DOUBLING = 1;
export const KAKAO_MAX_LEVEL = 13;

const koreaCorners = [
  [XMIN, YMIN],
  [XMAX, YMIN],
  [XMIN, YMAX],
  [XMAX, YMAX],
].map(([x, y]) => proj4("EPSG:5179", "WGS84", [x, y]) as [number, number]);

/** 행정 레이어와 같은 TM 박스의 WGS84 범위 (제주·독도 포함) */
export const KOREA_BOUNDS = {
  sw: {
    lng: Math.min(...koreaCorners.map((c) => c[0])),
    lat: Math.min(...koreaCorners.map((c) => c[1])),
  },
  ne: {
    lng: Math.max(...koreaCorners.map((c) => c[0])),
    lat: Math.max(...koreaCorners.map((c) => c[1])),
  },
};

export function clampToKorea(p: LatLng): LatLng {
  return {
    lat: Math.min(KOREA_BOUNDS.ne.lat, Math.max(KOREA_BOUNDS.sw.lat, p.lat)),
    lng: Math.min(KOREA_BOUNDS.ne.lng, Math.max(KOREA_BOUNDS.sw.lng, p.lng)),
  };
}

export function scaleToKakaoLevel(scale: number): number {
  const s = Math.max(1, scale);
  const level = Math.round(
    KAKAO_LEVEL_AT_SCALE_1 - LEVELS_PER_SCALE_DOUBLING * Math.log2(s),
  );
  return Math.min(KAKAO_MAX_LEVEL, Math.max(3, level));
}

export function kakaoLevelToScale(level: number): number {
  const lv = Math.min(KAKAO_MAX_LEVEL, Math.max(1, level));
  return Math.pow(
    2,
    (KAKAO_LEVEL_AT_SCALE_1 - lv) / LEVELS_PER_SCALE_DOUBLING,
  );
}

export function svgViewToKakao(
  view: SvgView,
  vbW = WIDTH,
  vbH = HEIGHT,
): { center: LatLng; level: number; svgScale: number } {
  const [cx, cy] = viewCenterSvg(view, vbW, vbH);
  return {
    center: svgToWgs84(cx, cy),
    level: scaleToKakaoLevel(view.scale),
    svgScale: view.scale,
  };
}

export function kakaoToSvgView(
  center: LatLng,
  level: number,
  vbW = WIDTH,
  vbH = HEIGHT,
  svgScale?: number,
): SvgView {
  const [cx, cy] = wgs84ToSvg(center.lat, center.lng);
  const scale = svgScale ?? kakaoLevelToScale(level);
  return viewFromCenterSvg(cx, cy, scale, vbW, vbH);
}

export const SVG_VIEWBOX: [number, number] = [WIDTH, HEIGHT];