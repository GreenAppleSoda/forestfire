"use client";

import type { AdminLayer, MapData } from "@/lib/types";
import { readApiJson } from "@/lib/apiJson";
import { useEffect, useState } from "react";

type SyncInfo = {
  last_sync_at?: string;
  added?: number;
  fetched?: number;
  refined_total?: number;
  source?: string;
};

type Props = {
  onUpdated: (payload: {
    mapData: MapData;
    layers: { sido: AdminLayer; sigungu: AdminLayer; emd: AdminLayer };
    sync: SyncInfo;
  }) => void;
};

type MapBundle = {
  mapData: MapData;
  layers: { sido: AdminLayer; sigungu: AdminLayer; emd: AdminLayer };
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** sync가 public/data 를 갱신한 직후, 캐시 없이 정적 JSON을 읽는다. */
async function fetchPublicJson<T>(path: string): Promise<T> {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`${path} (${res.status})`);
  }
  const data = (await res.json()) as T;
  return data;
}

function isUsableMapData(data: MapData | null | undefined): data is MapData {
  return Array.isArray(data?.regions) || Array.isArray(data?.provinces);
}

function isUsableLayer(layer: AdminLayer | null | undefined): layer is AdminLayer {
  return Array.isArray(layer?.regions);
}

/**
 * 동기화 직후 Next가 public/data 변경으로 재컴파일하는 동안
 * /api/map 프록시가 깨질 수 있어, 정적 파일을 우선 재시도한다.
 */
async function loadMapBundleAfterSync(): Promise<MapBundle> {
  const attempts = 5;
  let lastError: unknown;

  for (let i = 0; i < attempts; i++) {
    // 첫 시도 전·재시도마다 대기 (파일 flush + Next HMR 안정화)
    await sleep(i === 0 ? 400 : 500 * i);
    try {
      const [mapData, sido, sigungu, emd] = await Promise.all([
        fetchPublicJson<MapData>("/data/map-data.json"),
        fetchPublicJson<AdminLayer>("/data/admin-sido.json"),
        fetchPublicJson<AdminLayer>("/data/admin-sigungu.json"),
        fetchPublicJson<AdminLayer>("/data/admin-emd.json"),
      ]);
      if (
        !isUsableMapData(mapData) ||
        !isUsableLayer(sido) ||
        !isUsableLayer(sigungu) ||
        !isUsableLayer(emd)
      ) {
        throw new Error("맵 JSON 형식이 올바르지 않습니다");
      }
      return {
        mapData,
        layers: { sido, sigungu, emd },
      };
    } catch (e) {
      lastError = e;
    }
  }

  // 정적 파일이 아직 안 되면 API 프록시로 한 번 더 시도
  try {
    const [mapRes, sidoRes, sigunguRes, emdRes] = await Promise.all([
      fetch("/api/map/data", { cache: "no-store" }),
      fetch("/api/map/admin/sido", { cache: "no-store" }),
      fetch("/api/map/admin/sigungu", { cache: "no-store" }),
      fetch("/api/map/admin/emd", { cache: "no-store" }),
    ]);
    const [mapJson, sidoJson, sigunguJson, emdJson] = await Promise.all([
      readApiJson(mapRes),
      readApiJson(sidoRes),
      readApiJson(sigunguRes),
      readApiJson(emdRes),
    ]);
    if (
      !mapJson.ok ||
      !sidoJson.ok ||
      !sigunguJson.ok ||
      !emdJson.ok ||
      !isUsableMapData(mapJson.data as MapData) ||
      !isUsableLayer(sidoJson.data as AdminLayer) ||
      !isUsableLayer(sigunguJson.data as AdminLayer) ||
      !isUsableLayer(emdJson.data as AdminLayer)
    ) {
      throw new Error("맵 API 응답이 올바르지 않습니다");
    }
    return {
      mapData: mapJson.data as MapData,
      layers: {
        sido: sidoJson.data as AdminLayer,
        sigungu: sigunguJson.data as AdminLayer,
        emd: emdJson.data as AdminLayer,
      },
    };
  } catch (e) {
    lastError = e;
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("맵 데이터 갱신 실패");
}

export function HistorySyncControl({ onUpdated }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<SyncInfo | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/wildfires/sync/status");
        const json = await readApiJson(res);
        if (!cancelled && json.ok && json.data) setInfo(json.data as SyncInfo);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const run = async () => {
    setLoading(true);
    setError(null);
    let syncOk = false;
    try {
      const syncRes = await fetch("/api/wildfires/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const syncJson = await readApiJson(syncRes);
      if (!syncRes.ok || !syncJson.ok) {
        throw new Error(syncJson.error || "동기화 실패");
      }
      const sync = (syncJson.data || {}) as SyncInfo;
      setInfo(sync);
      syncOk = true;

      const bundle = await loadMapBundleAfterSync();
      onUpdated({
        ...bundle,
        sync,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "동기화 실패";
      if (syncOk) {
        setError(
          "이력은 반영됐습니다. 지도 표시 갱신에 실패했습니다. 페이지를 새로고침해 주세요.",
        );
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex max-w-md items-center gap-3">
      <div className="min-w-0 flex-1">
        <p className="text-[12px] font-medium text-[#1c1917]">
          산불 이력 동기화
        </p>
        {info?.last_sync_at ? (
          <p className="mt-0.5 truncate text-[10px] text-[#78716c]">
            최근 {info.last_sync_at}
            {typeof info.refined_total === "number"
              ? ` · 전체 ${info.refined_total.toLocaleString()}건`
              : ""}
          </p>
        ) : (
          <p className="mt-0.5 text-[10px] text-[#78716c]">
            버튼을 눌러 최신 이력 반영
          </p>
        )}
        {error && (
          <p className="mt-0.5 text-[10px] text-[#b91c1c]">{error}</p>
        )}
      </div>
      <button
        type="button"
        disabled={loading}
        onClick={run}
        className="shrink-0 rounded-md bg-[#1c1917] px-3 py-1.5 text-[12px] font-medium whitespace-nowrap text-white disabled:opacity-50"
      >
        {loading ? "갱신 중…" : "산불이력 갱신"}
      </button>
    </div>
  );
}
