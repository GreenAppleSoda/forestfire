"use client";

import type { AdminLayer, MapData } from "@/lib/types";
import { readApiJson } from "@/lib/apiJson";
import { useCallback, useEffect, useState } from "react";

type SyncInfo = {
  last_sync_at?: string;
  added?: number;
  fetched?: number;
  refined_total?: number;
  source?: string;
};

function isUsableMapData(data: MapData | null | undefined): data is MapData {
  return Array.isArray(data?.regions) || Array.isArray(data?.provinces);
}

function isUsableLayer(layer: AdminLayer | null | undefined): layer is AdminLayer {
  return Array.isArray(layer?.regions);
}

async function loadMapBundleAfterSync(): Promise<{
  mapData: MapData;
  layers: { sido: AdminLayer; sigungu: AdminLayer; emd: AdminLayer };
}> {
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
}

export function useHistorySync(onUpdated: (payload: {
  mapData: MapData;
  layers: { sido: AdminLayer; sigungu: AdminLayer; emd: AdminLayer };
}) => void) {
  const [syncing, setSyncing] = useState(false);
  const [syncLastAt, setSyncLastAt] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/wildfires/sync/status");
        const json = await readApiJson(res);
        if (!cancelled && json.ok && json.data) {
          const info = json.data as SyncInfo;
          if (info.last_sync_at) setSyncLastAt(info.last_sync_at);
        }
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const runSync = useCallback(async () => {
    setSyncing(true);
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
      const info = (syncJson.data || {}) as SyncInfo;
      if (info.last_sync_at) setSyncLastAt(info.last_sync_at);

      const bundle = await loadMapBundleAfterSync();
      onUpdated(bundle);
    } catch {
      /* errors handled silently */
    } finally {
      setSyncing(false);
    }
  }, [onUpdated]);

  return { syncing, syncLastAt, runSync };
}
