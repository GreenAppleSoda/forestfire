import { KoreaSvgMap } from "@/components/KoreaSvgMap";
import type { AdminLayer, DailyMlRisk, MapData, SigunguMlScores } from "@/lib/types";
import { readFile } from "fs/promises";
import path from "path";

export const dynamic = "force-dynamic";

async function loadJson<T>(file: string): Promise<T | null> {
  try {
    const full = path.join(process.cwd(), "public", "data", file);
    const raw = await readFile(full, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export default async function HomePage() {
  const [mapData, sido, sigungu, emd, mlScores, dailyRisk] = await Promise.all([
    loadJson<MapData>("map-data.json"),
    loadJson<AdminLayer>("admin-sido.json"),
    loadJson<AdminLayer>("admin-sigungu.json"),
    loadJson<AdminLayer>("admin-emd.json"),
    loadJson<SigunguMlScores>("sigungu_ml_scores.json"),
    loadJson<DailyMlRisk>("daily_ml_risk.json"),
  ]);

  if (!mapData || !sido || !sigungu || !emd) {
    throw new Error("필수 지도 데이터가 없습니다.");
  }

  return (
    <KoreaSvgMap
      mapData={mapData}
      layers={{ sido, sigungu, emd }}
      mlScores={mlScores}
      dailyRisk={dailyRisk}
    />
  );
}
