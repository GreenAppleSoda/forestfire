/** 파랑(안전) → 노랑 → 주황 → 빨강. HSL 보간으로 초록 구간을 피함. */

type HslStop = { t: number; h: number; s: number; l: number };

export const RISK_STOPS: HslStop[] = [
  { t: 0, h: 224, s: 76, l: 48 },
  { t: 0.22, h: 199, s: 89, l: 58 },
  { t: 0.48, h: 45, s: 93, l: 52 },
  { t: 0.72, h: 25, s: 95, l: 50 },
  { t: 1, h: 0, s: 72, l: 46 },
];

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const sn = s / 100;
  const ln = l / 100;
  const c = (1 - Math.abs(2 * ln - 1)) * sn;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = ln - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255),
  ];
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`.toUpperCase();
}

function lerp(a: number, b: number, u: number) {
  return a + (b - a) * u;
}

function interpolateStops(t: number): string {
  const clamped = Math.max(0, Math.min(1, t));
  for (let i = 0; i < RISK_STOPS.length - 1; i++) {
    const a = RISK_STOPS[i];
    const b = RISK_STOPS[i + 1];
    if (clamped <= b.t || i === RISK_STOPS.length - 2) {
      const u = b.t === a.t ? 0 : (clamped - a.t) / (b.t - a.t);
      const h = lerp(a.h, b.h, u);
      const s = lerp(a.s, b.s, u);
      const l = lerp(a.l, b.l, u);
      const [r, g, bl] = hslToRgb(h, s, l);
      return rgbToHex(r, g, bl);
    }
  }
  const last = RISK_STOPS[RISK_STOPS.length - 1];
  const [r, g, b] = hslToRgb(last.h, last.s, last.l);
  return rgbToHex(r, g, b);
}

/** 확률(0~1) → 지도·범례 공통 색상 */
export function probToColor(prob: number): string {
  return interpolateStops(prob);
}

/** 범례용 CSS linear-gradient */
export function riskLegendGradient(): string {
  const parts = RISK_STOPS.map((s) => `${interpolateStops(s.t)} ${Math.round(s.t * 100)}%`);
  return `linear-gradient(to right, ${parts.join(", ")})`;
}
