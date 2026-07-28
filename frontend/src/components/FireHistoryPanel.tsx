"use client";

import type { FireEvent, MountainInfo, ProvinceStat } from "@/lib/types";
import {
  formatRegionPath,
  type LegalDongLookup,
} from "@/lib/legalDong";
import { useEffect, useMemo, useState } from "react";
import { MountainChip, MountainDetail } from "./MountainDetail";

type Props = {
  province: ProvinceStat | null;
  events: FireEvent[];
  mountainIndex?: Record<string, MountainInfo>;
  totalFires: number;
  totalMountains?: number;
  matchedFires?: number;
  /** 0~1 산불 추정 확률 */
  probability?: number;
  probabilityLabel?: string;
  /** 산 클릭 시 지도에 마커 표시 */
  onLocateMountain?: (mountain: MountainInfo) => void;
  onClose: () => void;
};

type Tab = "fires" | "linked" | "catalog";

function formatWhen(value: string) {
  if (!value) return "-";
  return value.replace("T", " ").slice(0, 16);
}

function resolveMountains(
  ev: FireEvent,
  index?: Record<string, MountainInfo>,
): MountainInfo[] {
  if (ev.mountain_list?.length) {
    return ev.mountain_list.map((m) =>
      m.id && index?.[m.id]
        ? {
            ...index[m.id],
            fire_count: m.fire_count || index[m.id].fire_count,
          }
        : m,
    );
  }
  return [];
}

export function FireHistoryPanel({
  province,
  events,
  mountainIndex,
  totalFires,
  totalMountains,
  matchedFires,
  probability,
  probabilityLabel,
  onLocateMountain,
  onClose,
}: Props) {
  const [tab, setTab] = useState<Tab>("fires");
  const [selectedMountain, setSelectedMountain] = useState<MountainInfo | null>(
    null,
  );
  const [legalDong, setLegalDong] = useState<LegalDongLookup | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/data/legal-dong-lookup.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: LegalDongLookup | null) => {
        if (!cancelled && data?.sido) setLegalDong(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const openMountain = (m: MountainInfo) => {
    const full =
      m.id && mountainIndex?.[m.id] ? { ...mountainIndex[m.id], ...m } : m;
    setSelectedMountain(full);
    onLocateMountain?.(full);
  };

  useEffect(() => {
    setSelectedMountain(null);
    setTab("fires");
  }, [province?.code]);

  const topMountains = useMemo(() => {
    if (!province) return [];
    if (province.top_mountains?.length) return province.top_mountains;
    const freq = new Map<string, MountainInfo>();
    for (const ev of events) {
      for (const m of resolveMountains(ev, mountainIndex)) {
        const key = m.id || m.name;
        const prev = freq.get(key);
        if (prev) {
          freq.set(key, { ...prev, fire_count: prev.fire_count + 1 });
        } else {
          freq.set(key, { ...m, fire_count: Math.max(1, m.fire_count) });
        }
      }
    }
    return [...freq.values()]
      .sort(
        (a, b) =>
          b.fire_count - a.fire_count || a.name.localeCompare(b.name, "ko"),
      )
      .slice(0, 12);
  }, [province, events, mountainIndex]);

  const catalog = province?.catalog_mountains ?? [];

  return (
    <aside className="flex h-full w-full flex-col border-l border-[#d6d3d1] bg-[#F7F5F1]">
      <div className="shrink-0 border-b border-[#e7e5e4] px-5 py-4">
        <p className="text-[12px] font-medium text-[#78716c]">
          산림청에 등록된 산 현황
        </p>
        <p className="mt-1 text-2xl font-bold text-[#1c1917]">
          {totalFires.toLocaleString()}
        </p>
        <p className="mt-0.5 text-[12px] text-[#78716c]">
          산불
          {totalMountains != null
            ? ` · 산 ${totalMountains.toLocaleString()}개`
            : ""}
          {matchedFires != null
            ? ` · 발생지 일치 ${matchedFires.toLocaleString()}`
            : ""}
        </p>
      </div>

      {!province ? (
        <div className="flex flex-1 flex-col items-start justify-center px-5 py-8">
          <p className="font-[family-name:var(--font-display)] text-xl text-[#1c1917]">
            지역을 선택하세요
          </p>
          <p className="mt-2 text-sm leading-relaxed text-[#78716c]">
            스크롤로 행정구역을 세분화한 뒤, 색이 입혀진 지역을 클릭하면 산불
            확률과 이력이 표시됩니다.
          </p>
        </div>
      ) : selectedMountain ? (
        <div className="min-h-0 flex-1">
          <MountainDetail
            mountain={selectedMountain}
            onBack={() => setSelectedMountain(null)}
          />
        </div>
      ) : (
        <>
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[#e7e5e4] px-5 py-2.5">
            <div className="min-w-0">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <h2 className="font-[family-name:var(--font-display)] text-lg tracking-tight text-[#1c1917]">
                  {province.name}
                </h2>
                <p className="text-[12px] text-[#78716c]">
                  {province.province_name ?? province.province ?? ""}
                </p>
              </div>
              <p className="mt-0.5 text-[12px] leading-snug text-[#57534e]">
                {probability != null && (
                  <>
                    <span className="text-[#78716c]">
                      {probabilityLabel ?? "산불 추정 확률"}{" "}
                    </span>
                    <span className="text-2xl font-bold text-[#b91c1c]">
                      {(probability * 100).toFixed(1)}%
                    </span>
                    <span className="text-[#d6d3d1]"> · </span>
                  </>
                )}
                산불 {province.fire_count.toLocaleString()}건 · 산{" "}
                {(province.mountain_count ?? 0).toLocaleString()}개 · 위험{" "}
                {province.risk_score}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="shrink-0 rounded-md border border-[#d6d3d1] bg-white px-2.5 py-1 text-[13px] text-[#44403c] transition hover:bg-[#f5f5f4]"
            >
              닫기
            </button>
          </div>

          <div className="flex shrink-0 border-b border-[#e7e5e4] px-5">
            {(
              [
                ["fires", "산불 이력"],
                ["linked", "연결 산"],
                ["catalog", "산 도감"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                className={`mr-4 border-b-2 py-2.5 text-sm transition ${
                  tab === id
                    ? "border-[#1c1917] font-medium text-[#1c1917]"
                    : "border-transparent text-[#78716c] hover:text-[#44403c]"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {tab === "fires" ? (
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
              {events.length === 0 ? (
                <p className="text-sm text-[#a8a29e]">
                  표시할 이력이 없습니다.
                </p>
              ) : (
                <ul className="space-y-4">
                  {events.map((ev, i) => {
                    const mountains = resolveMountains(ev, mountainIndex);
                    return (
                      <li
                        key={`${ev.datetime}-${ev.region}-${i}`}
                        className="border-b border-[#e7e5e4] pb-4"
                      >
                        <div className="flex items-baseline justify-between gap-3">
                          <time className="text-sm font-medium text-[#1c1917]">
                            {formatWhen(ev.datetime)}
                          </time>
                          <span className="text-xs text-[#78716c]">
                            {ev.damage_area.toLocaleString()} ha
                          </span>
                        </div>
                        <p className="mt-1 text-sm text-[#44403c]">
                          {formatRegionPath(ev.region, legalDong)}
                        </p>
                        {mountains.length > 0 ? (
                          <div className="mt-2">
                            <p className="text-[11px] font-medium text-[#78716c]">
                              발생지 일치 산 · 클릭하면 지도 표시·상세
                            </p>
                            <div className="mt-1.5 flex flex-wrap gap-1">
                              {mountains.map((m) => (
                                <button
                                  key={m.id || m.name}
                                  type="button"
                                  onClick={() => openMountain(m)}
                                  className="rounded bg-[#1c1917] px-2 py-0.5 text-[12px] text-[#fafaf9] transition hover:bg-[#44403c]"
                                  title={
                                    m.height && m.height > 0
                                      ? `${m.height}m · ${m.address}`
                                      : m.address
                                  }
                                >
                                  {m.name}
                                  {m.height && m.height > 0
                                    ? ` ${Math.round(m.height)}m`
                                    : ""}
                                </button>
                              ))}
                            </div>
                          </div>
                        ) : (
                          <p className="mt-2 text-[13px] text-[#a8a29e]">
                            이 건은 발생 읍면·시군구와 일치하는 산 없음
                          </p>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          ) : tab === "linked" ? (
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
              <p className="mb-3 text-[13px] text-[#78716c]">
                같은 읍면·시군구로 자주 연결된 산 · 클릭하면 지도 표시·상세
              </p>
              {topMountains.length === 0 ? (
                <p className="text-sm text-[#a8a29e]">표시할 산이 없습니다.</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {topMountains.map((m) => (
                    <MountainChip
                      key={m.id || m.name}
                      mountain={m}
                      onSelect={openMountain}
                    />
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
              <p className="mb-3 text-[13px] text-[#78716c]">
                전국 산 정보({province.mountain_count?.toLocaleString()}개 중
                대표) · 클릭하면 지도에 위치 표시
              </p>
              {catalog.length === 0 ? (
                <p className="text-sm text-[#a8a29e]">등록된 산이 없습니다.</p>
              ) : (
                <ul className="space-y-3">
                  {catalog.map((m) => (
                    <li key={m.id || m.name}>
                      <button
                        type="button"
                        onClick={() => openMountain(m)}
                        className="w-full rounded-md border border-[#e7e5e4] bg-white px-3.5 py-3 text-left transition hover:border-[#a8a29e]"
                      >
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="font-medium text-[#1c1917]">
                            {m.name}
                          </span>
                          <span className="text-xs text-[#78716c]">
                            {m.height && m.height > 0
                              ? `${m.height.toLocaleString()} m`
                              : "고도 미상"}
                          </span>
                        </div>
                        {m.address && (
                          <p className="mt-1 text-[12px] text-[#78716c]">
                            {m.address}
                          </p>
                        )}
                        {(m.notable || m.details) && (
                          <p className="mt-1.5 line-clamp-2 text-[13px] leading-snug text-[#57534e]">
                            {m.notable || m.details}
                          </p>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className="shrink-0 border-t border-[#e7e5e4] px-5 py-2.5 text-[11px] leading-relaxed text-[#78716c]">
            산 정보는 전국 산 목록(korea_mountains) 기준입니다. 산불
            원본에 산 이름이 없어, 발생 읍면(없으면 시군구)과 산소재지가
            같은 산을 &apos;발생지 일치 산&apos;으로 연결합니다. 발화
            봉우리 확정이 아닙니다.
          </div>
        </>
      )}
    </aside>
  );
}
