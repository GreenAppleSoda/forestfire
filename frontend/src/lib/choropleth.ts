/** 국가산불위험예보 스타일: 0~100을 10칸 단색 블록으로 구분. */

/** 구간 [0,10), [10,20), …, [90,100] — 이미지와 동일한 10단 */
export const RISK_BAND_COLORS = [
  "#0D2F6B", // 0–10  남색
  "#1E5AA8", // 10–20 파랑
  "#0E7C8A", // 20–30 청록
  "#3DB8E8", // 30–40 하늘
  "#7BCB2E", // 40–50 연두
  "#C5D94A", // 50–60 연두노랑
  "#F2E14A", // 60–70 노랑
  "#F5B84A", // 70–80 살구
  "#F07A1A", // 80–90 주황
  "#E53935", // 90–100 빨강
] as const;

export const RISK_TICKS = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100] as const;

/** 당일/시나리오: 절대 확률(0~1) = 위험지수(0~100) 전 구간. */
export const ABS_COLOR_FOCUS = 1;

/** 위험지수 0~100 → 10칸 중 인덱스(0~9). 100은 마지막 칸. */
export function scoreToBandIndex(score: number): number {
  const s = Math.max(0, Math.min(100, Number(score) || 0));
  if (s >= 100) return 9;
  return Math.min(9, Math.floor(s / 10));
}

/** 절대 확률(0~1) → 해당 10칸 단색 */
export function probToColor(prob: number): string {
  const score = Math.max(0, Math.min(1, Number(prob) || 0)) * 100;
  return RISK_BAND_COLORS[scoreToBandIndex(score)];
}

/** 이력 기반: 상대 빈도(0~1) → 같은 10칸 팔레트 */
export function intensityToColor(intensity: number): string {
  const t = Math.max(0, Math.min(1, Number(intensity) || 0));
  return RISK_BAND_COLORS[scoreToBandIndex(t * 100)];
}

/** @deprecated 호환용 — 이제는 선형 densify 없이 칸 매핑 */
export function densifyAbsoluteProb(prob: number): number {
  return Math.max(0, Math.min(1, Number(prob) || 0));
}

/** 당일/시나리오 범례 — 10칸 단색 (경계에서 색이 끊김) */
export function riskLegendGradient(): string {
  const parts: string[] = [];
  for (let i = 0; i < RISK_BAND_COLORS.length; i++) {
    const c = RISK_BAND_COLORS[i];
    const a = i * 10;
    const b = (i + 1) * 10;
    parts.push(`${c} ${a}%`, `${c} ${b}%`);
  }
  return `linear-gradient(to right, ${parts.join(", ")})`;
}

/** 이력 기반 범례 — 동일 10칸 */
export function frequencyLegendGradient(): string {
  return riskLegendGradient();
}
