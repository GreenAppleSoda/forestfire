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
      const sync = syncJson.data as SyncInfo;
      setInfo(sync);

      const [mapRes, sidoRes, sigRes, emdRes] = await Promise.all([
        fetch("/api/map/data"),
        fetch("/api/map/admin/sido"),
        fetch("/api/map/admin/sigungu"),
        fetch("/api/map/admin/emd"),
      ]);
      const [mapJ, sidoJ, sigJ, emdJ] = await Promise.all([
        mapRes.json(),
        sidoRes.json(),
        sigRes.json(),
        emdRes.json(),
      ]);
      if (!mapJ.ok || !sidoJ.ok || !sigJ.ok || !emdJ.ok) {
        throw new Error("갱신된 지도 데이터를 불러오지 못했습니다.");
      }
      onUpdated({
        mapData: mapJ.data as MapData,
        layers: {
          sido: sidoJ.data as AdminLayer,
          sigungu: sigJ.data as AdminLayer,
          emd: emdJ.data as AdminLayer,
        },
        sync,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="pointer-events-auto w-72 rounded-lg border border-[#d6d3d1] bg-white/95 px-3 py-2.5 text-sm shadow-sm backdrop-blur-sm">
      <p className="text-[11px] font-medium tracking-[0.12em] text-[#78716c] uppercase">
        산불 이력 동기화
      </p>
      <p className="mt-1 text-[11px] leading-snug text-[#57534e]">
        공공데이터포털 산불발생통계 OpenAPI로 이력을 증분 반영하고, 이력 맵
        색·건수를 갱신합니다.
      </p>
      <button
        type="button"
        disabled={loading}
        onClick={run}
        className="mt-2 w-full rounded-md bg-[#1c1917] px-2 py-1.5 text-[11px] font-medium text-white disabled:opacity-50"
      >
        {loading ? "동기화·맵 갱신 중…" : "OpenAPI로 이력 갱신"}
      </button>
      {info?.last_sync_at && (
        <p className="mt-1.5 text-[10px] leading-snug text-[#78716c]">
          최근 동기화 {info.last_sync_at}
          {typeof info.added === "number" ? ` · +${info.added}건` : ""}
          {typeof info.refined_total === "number"
            ? ` · 전체 ${info.refined_total.toLocaleString()}건`
            : ""}
        </p>
      )}
      {error && (
        <p className="mt-1.5 text-[10px] leading-snug text-[#b91c1c]">{error}</p>
      )}
    </div>
  );
}
