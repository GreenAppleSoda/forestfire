"use client";

import type { AdminLayer, MapData } from "@/lib/types";
import { readApiJson } from "@/lib/apiJson";
import { loadMapBundleFromApi } from "@/lib/mapBundle";
import { useCallback, useEffect, useState } from "react";

type SyncInfo = {
  last_sync_at?: string;
  added?: number;
  fetched?: number;
  refined_total?: number;
  source?: string;
};

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

      const bundle = await loadMapBundleFromApi();
      onUpdated(bundle);
    } catch {
      /* errors handled silently */
    } finally {
      setSyncing(false);
    }
  }, [onUpdated]);

  return { syncing, syncLastAt, runSync };
}
