"use client";

import type { AdminLayer, MapData } from "@/lib/types";
import { useEffect, useState } from "react";

type SyncInfo = {
  last_sync_at?: string;
  added?: number;
  fetched?: number;
  refined_total?: number;
  query_start?: string;
  query_end?: string;
};

type Props = {
  onUpdated: (payload: {
    mapData: MapData;
    layers: { sido: AdminLayer; sigungu: AdminLayer; emd: AdminLayer };
    sync: SyncInfo;
  }) => void;
};

export function HistorySyncControl({ onUpdated }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<SyncInfo | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/wildfires/sync/status");
        const json = await res.json();
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
    try {
      const syncRes = await fetch("/api/wildfires/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ days: 120 }),
      });
      const syncJson = await syncRes.json();
      if (!syncRes.ok || !syncJson.ok) {
        throw new Error(syncJson.error || "동기화 실패");
      }
      const sync = (syncJson.data || {}) as SyncInfo;
      setInfo(sync);

      const [mapRes, sidoRes, sigunguRes, emdRes] = await Promise.all([
        fetch("/api/map/data"),
        fetch("/api/map/admin/sido"),
        fetch("/api/map/admin/sigungu"),
        fetch("/api/map/admin/emd"),
      ]);
      const [mapJson, sidoJson, sigunguJson, emdJson] = await Promise.all([
        mapRes.json(),
        sidoRes.json(),
        sigunguRes.json(),
        emdRes.json(),
      ]);
      if (!mapJson.ok || !sidoJson.ok || !sigunguJson.ok || !emdJson.ok) {
        throw new Error("맵 데이터 갱신 실패");
      }
      onUpdated({
        mapData: mapJson.data as MapData,
        layers: {
          sido: sidoJson.data as AdminLayer,
          sigungu: sigunguJson.data as AdminLayer,
          emd: emdJson.data as AdminLayer,
        },
        sync,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "동기화 실패");
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
            {typeof info.added === "number" ? ` · +${info.added}건` : ""}
            {typeof info.refined_total === "number"
              ? ` · 전체 ${info.refined_total.toLocaleString()}건`
              : ""}
          </p>
        ) : (
          <p className="mt-0.5 text-[10px] text-[#78716c]">
            OpenAPI로 이력 증분 반영
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
        {loading ? "갱신 중…" : "OpenAPI로 이력 갱신"}
      </button>
    </div>
  );
}
