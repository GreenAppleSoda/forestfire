/** 초록(낮음) → 연두 → 노랑 → 주황(높음). */

type HslStop = { t: number; h: number; s: number; l: number };

export const RISK_STOPS: HslStop[] = [
  { t: 0, h: 142, s: 55, l: 38 },
  { t: 0.28, h: 98, s: 52, l: 46 },
  { t: 0.55, h: 55, s: 78, l: 50 },
  { t: 0.78, h: 36, s: 90, l: 50 },
  { t: 1, h: 24, s: 92, l: 48 },
];

/** 이 절대 확률 이상이면 색 스케일 최댓값(주황). 낮은 구간을 더 촘촘히 펼침. */
export const ABS_COLOR_FOCUS = 0.4;

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

/**
 * 절대 확률(0~1) → 색 위치(0~1).
 * 전국 min-max 상대 정규화가 아니라, 낮은 절대값 구간을 색으로 더 펼침.
 * 예: 25% ≈ 스케일 중간~주황 쪽, 40%+ ≈ 최고색.
 */
export function densifyAbsoluteProb(
  prob: number,
  focusHigh = ABS_COLOR_FOCUS,
): number {
  const p = Math.max(0, Math.min(1, Number(prob) || 0));
  if (p >= focusHigh) return 1;
  const u = p / focusHigh;
  // 0.65: 중·저구간 대비를 조금 더 살림
  return Math.pow(u, 0.65);
}

/** 확률(0~1) → 지도·범례 공통 색상 (절대값 + 낮은 구간 강조) */
export function probToColor(prob: number): string {
  return interpolateStops(densifyAbsoluteProb(prob));
}

/** 범례용 CSS linear-gradient — 바는 0%~40%+ 절대 확률 구간 */
export function riskLegendGradient(): string {
  const absTicks = [0, 0.08, 0.15, 0.22, 0.3, 0.4];
  const parts = absTicks.map((p, i) => {
    const barPct = Math.round((i / (absTicks.length - 1)) * 100);
    return `${probToColor(p)} ${barPct}%`;
  });
  return `linear-gradient(to right, ${parts.join(", ")})`;
}
