import type { SigunguMlRegion } from "./types";

export type NationalRiskSummary = {
  avg: number;
  topProvince: string;
};

/** ml_risk(0~1) → 산불위험지수(0~100, 소수 1자리) */
function riskIndex(mlRisk: number): number {
  return Math.round((Number(mlRisk) || 0) * 1000) / 10;
}

/** 시군구 예측 배열에서 전국 평균·최고 위험 시도 */
export function summarizeNationalRisk(
  regions: SigunguMlRegion[] | null | undefined,
): NationalRiskSummary | null {
  if (!regions?.length) return null;

  const scores = regions.map((r) => riskIndex(r.ml_risk));
  const avg = Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10;

  const byProv = new Map<string, number[]>();
  for (const r of regions) {
    const name = (r.province || "").trim();
    if (!name) continue;
    const list = byProv.get(name) ?? [];
    list.push(riskIndex(r.ml_risk));
    byProv.set(name, list);
  }
  if (!byProv.size) return { avg, topProvince: "—" };

  let topProvince = "—";
  let topAvg = -1;
  for (const [name, vals] of byProv) {
    const a = vals.reduce((x, y) => x + y, 0) / vals.length;
    if (a > topAvg) {
      topAvg = a;
      topProvince = name;
    }
  }
  return { avg, topProvince };
}
