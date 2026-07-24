import { KoreaSvgMap } from "@/components/KoreaSvgMap";
import type { AdminLayer, DailyMlRisk, MapData, SigunguMlScores } from "@/lib/types";

export const dynamic = "force-dynamic";

const EXPRESS_URL = process.env.EXPRESS_URL || "http://localhost:4000";

async function fetchApi<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${EXPRESS_URL}${path}`, {
      cache: "no-store",
      next: { revalidate: 0 },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { ok?: boolean; data?: T };
    if (json && "data" in json) return json.data ?? null;
    return json as T;
  } catch {
    return null;
  }
}

export default async function HomePage() {
  const [mapData, sido, sigungu, emd, mlScores, dailyRisk] = await Promise.all([
    fetchApi<MapData>("/api/map/data"),
    fetchApi<AdminLayer>("/api/map/admin/sido"),
    fetchApi<AdminLayer>("/api/map/admin/sigungu"),
    fetchApi<AdminLayer>("/api/map/admin/emd"),
    fetchApi<SigunguMlScores>("/api/map/ml-scores"),
    fetchApi<DailyMlRisk>("/api/map/daily-risk"),
  ]);

  if (!mapData || !sido || !sigungu || !emd) {
    throw new Error(
      "필수 지도 데이터를 불러오지 못했습니다. Express(server)가 실행 중인지 확인하세요.",
    );
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
