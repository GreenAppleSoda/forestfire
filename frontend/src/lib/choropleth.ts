/** 초록(낮음) → 연두 → 노랑 → 주황(높음). */

type HslStop = { t: number; h: number; s: number; l: number };

export const RISK_STOPS: HslStop[] = [
  { t: 0, h: 142, s: 55, l: 38 },
  { t: 0.28, h: 98, s: 52, l: 46 },
  { t: 0.55, h: 55, s: 78, l: 50 },
  { t: 0.78, h: 36, s: 90, l: 50 },
  { t: 1, h: 24, s: 92, l: 48 },
];

/** 당일/시나리오: 이 절대 확률 이상이면 색 스케일 최댓값.
 * Isotonic 보정 후 확률이 수 %대라 0~5% 구간을 펼친다.
 */
export const ABS_COLOR_FOCUS = 0.05;

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
 * 예: ~2.5% ≈ 스케일 중간, 5%+ ≈ 최고색.
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

/** 당일/시나리오: 절대 확률(0~1) → 색 */
export function probToColor(prob: number): string {
  return interpolateStops(densifyAbsoluteProb(prob));
}

/** 이력 기반: 상대 빈도(0~1, 같은 레벨 내 fire_count/max) → 색 */
export function intensityToColor(intensity: number): string {
  return interpolateStops(Math.max(0, Math.min(1, Number(intensity) || 0)));
}

/** 당일/시나리오 범례 — 바는 0%~focus%+ 절대 확률 구간 */
export function riskLegendGradient(): string {
  const f = ABS_COLOR_FOCUS;
  const absTicks = [0, f * 0.2, f * 0.4, f * 0.55, f * 0.75, f];
  const parts = absTicks.map((p, i) => {
    const barPct = Math.round((i / (absTicks.length - 1)) * 100);
    return `${probToColor(p)} ${barPct}%`;
  });
  return `linear-gradient(to right, ${parts.join(", ")})`;
}

/** 이력 기반 범례 — 상대 빈도 0~1 전 구간 */
export function frequencyLegendGradient(): string {
  const ticks = [0, 0.2, 0.4, 0.6, 0.8, 1];
  const parts = ticks.map((t, i) => {
    const barPct = Math.round((i / (ticks.length - 1)) * 100);
    return `${intensityToColor(t)} ${barPct}%`;
  });
  return `linear-gradient(to right, ${parts.join(", ")})`;
}
