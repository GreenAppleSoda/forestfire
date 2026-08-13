"use client";

import { KoreaSvgMap } from "@/components/KoreaSvgMap";
import type { AdminLayer, MapData, SigunguMlScores } from "@/lib/types";
import { useEffect, useState } from "react";

type InitialData = {
  mapData: MapData;
  sido: AdminLayer;
  sigungu: AdminLayer;
  emd: AdminLayer;
  mlScores: SigunguMlScores | null;
};

const EMPTY_EMD: AdminLayer = {
  level: "emd",
  viewBox: [800, 900],
  regions: [],
  markers: [],
  meta: {
    n_regions: 0,
    n_markers: 0,
    max_fire_count: 0,
    prob_note: "",
  },
};

async function fetchJson<T>(path: string, signal: AbortSignal): Promise<T | null> {
  try {
    const res = await fetch(path, { signal, cache: "default" });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export default function HomePage() {
  const [data, setData] = useState<InitialData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const signal = controller.signal;

    const load = async () => {
      // 1차: 시도/시군구로 바로 지도 표시 (읍면동은 백그라운드)
      const [mapData, sido, sigungu, mlScores] = await Promise.all([
        fetchJson<MapData>("/data/map-data.json", signal),
        fetchJson<AdminLayer>("/data/admin-sido.json", signal),
        fetchJson<AdminLayer>("/data/admin-sigungu.json", signal),
        fetchJson<SigunguMlScores>("/data/sigungu_ml_scores.json", signal),
      ]);

      if (!mapData || !sido || !sigungu) {
        setError("지도 데이터를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
        return;
      }

      setData({
        mapData,
        sido,
        sigungu,
        emd: EMPTY_EMD,
        mlScores,
      });

      // 2차: 고배율에서만 쓰는 읍면동 (가장 큰 파일)
      const emd = await fetchJson<AdminLayer>("/data/admin-emd.json", signal);
      if (emd) {
        setData((prev) => (prev ? { ...prev, emd } : prev));
      }
    };

    void load();
    return () => controller.abort();
  }, []);

  if (error) {
    return (
      <main className="grid h-dvh place-items-center bg-[#f4f7f9] px-6 text-center">
        <p className="max-w-md rounded-2xl bg-white px-4 py-3 text-sm text-[#4b5563] shadow-[var(--shadow-card)] ring-1 ring-[#e5e7eb]">
          {error}
        </p>
      </main>
    );
  }

  if (!data) {
    return (
      <main className="grid h-dvh place-items-center bg-[#f4f7f9] px-6 text-center">
        <p className="rounded-2xl bg-white px-4 py-3 text-sm text-[#4b5563] shadow-[var(--shadow-card)] ring-1 ring-[#e5e7eb]">
          지도를 불러오는 중입니다...
        </p>
      </main>
    );
  }

  return (
    <KoreaSvgMap
      mapData={data.mapData}
      layers={{ sido: data.sido, sigungu: data.sigungu, emd: data.emd }}
      mlScores={data.mlScores}
    />
  );
}
