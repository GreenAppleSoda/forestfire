"use client";

import type { FireEvent, MountainInfo, ProvinceStat } from "@/lib/types";
import {
  formatRegionPath,
  type LegalDongLookup,
} from "@/lib/legalDong";
import { useEffect, useMemo, useState } from "react";
import { MountainDetail } from "./MountainDetail";

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

function FlameTiny() {
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#fff1f0] text-[#e03131]">
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden>
        <path d="M12 2c.4 2.2-.3 3.8-1.4 5.2-.9 1.1-1.6 2-1.6 3.4 0 1.7 1.2 3 2.8 3.4-.6-1.3-.4-2.5.5-3.6 1.2-1.5 2.9-2.4 3.5-4.6.8 1.4 1.2 2.8 1.2 4.3 0 4.3-3 7.9-7 7.9S3 16.1 3 11.8C3 7.6 6.2 4.2 12 2z" />
      </svg>
    </span>
  );
}

function MountainGlyph() {
  return (
    <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl bg-[#f3f4f6] text-[#6b7280]">
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden>
        <path d="M3 18h18l-5.5-8-3.2 4.6L9.5 10 3 18zm11.2-9.2 1.3-1.9L18 12h-2.4l-1.4-3.2z" />
      </svg>
    </span>
  );
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
    <aside className="flex h-full w-full flex-col border-l border-[#e5e7eb] bg-white">
      <div className="shrink-0 border-b border-[#e5e7eb] px-5 py-4">
        <p className="text-[12px] font-medium text-[#6b7280]">전체 산불 이력</p>
        <p className="mt-1 text-[1.75rem] font-bold tracking-tight text-[#111827]">
          {totalFires.toLocaleString()}
          <span className="ml-1 text-base font-semibold text-[#6b7280]">건</span>
        </p>
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-[#6b7280]">
          {totalMountains != null ? (
            <span>산 {totalMountains.toLocaleString()}개</span>
          ) : null}
          {matchedFires != null ? (
            <span>발생지 일치 {matchedFires.toLocaleString()}</span>
          ) : null}
        </div>
      </div>

      {!province ? (
        <div className="flex flex-1 flex-col items-start justify-center px-5 py-8">
          <p className="text-xl font-semibold text-[#111827]">지역을 선택하세요</p>
          <p className="mt-2 text-sm leading-relaxed text-[#6b7280]">
            스크롤로 행정구역을 세분화한 뒤, 색이 입혀진 지역을 클릭하면 산불
            이력과 추정치가 표시됩니다.
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
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[#e5e7eb] px-5 py-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <h2 className="text-lg font-semibold tracking-tight text-[#111827]">
                  {province.name}
                </h2>
                <p className="text-[12px] text-[#6b7280]">
                  {province.province_name ?? province.province ?? ""}
                </p>
              </div>
              <p className="mt-0.5 text-[12px] leading-snug text-[#4b5563]">
                {probability != null && (
                  <>
                    <span className="text-[#6b7280]">
                      {probabilityLabel ?? "예측 발생 확률"}{" "}
                    </span>
                    <span className="text-xl font-bold text-[#e03131]">
                      {(probability * 100).toFixed(1)}%
                    </span>
                    <span className="text-[#d1d5db]"> · </span>
                  </>
                )}
                산불 {province.fire_count.toLocaleString()}건 · 산{" "}
                {(province.mountain_count ?? 0).toLocaleString()}개
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="shrink-0 rounded-xl px-2.5 py-1.5 text-[13px] text-[#4b5563] ring-1 ring-[#e5e7eb] transition hover:bg-[#f9fafb]"
            >
              닫기
            </button>
          </div>

          <div className="flex shrink-0 gap-1 border-b border-[#e5e7eb] px-4 pt-2">
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
                className={`rounded-t-lg px-3 py-2.5 text-sm transition ${
                  tab === id
                    ? "bg-[#f9fafb] font-semibold text-[#111827]"
                    : "text-[#6b7280] hover:text-[#111827]"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {tab === "fires" ? (
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
              <p className="mb-2 px-1 text-[12px] font-medium text-[#6b7280]">
                산불 이력 목록
              </p>
              {events.length === 0 ? (
                <p className="text-sm text-[#9ca3af]">표시할 이력이 없습니다.</p>
              ) : (
                <ul className="space-y-2">
                  {events.map((ev, i) => {
                    const mountains = resolveMountains(ev, mountainIndex);
                    return (
                      <li
                        key={`${ev.datetime}-${ev.region}-${i}`}
                        className="rounded-xl bg-[#f9fafb] px-3 py-3 ring-1 ring-[#eef2f6]"
                      >
                        <div className="flex items-start gap-3">
                          <FlameTiny />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-baseline justify-between gap-3">
                              <time className="text-sm font-medium text-[#111827]">
                                {formatWhen(ev.datetime)}
                              </time>
                              <span className="shrink-0 text-xs font-medium tabular-nums text-[#6b7280]">
                                {ev.damage_area.toLocaleString()} ha
                              </span>
                            </div>
                            <p className="mt-1 text-[13px] leading-snug text-[#4b5563]">
                              {formatRegionPath(ev.region, legalDong)}
                            </p>
                            {mountains.length > 0 && (
                              <div className="mt-2 flex flex-wrap gap-1">
                                {mountains.map((m) => (
                                  <button
                                    key={m.id || m.name}
                                    type="button"
                                    onClick={() => openMountain(m)}
                                    className="rounded-lg bg-[#111827] px-2 py-0.5 text-[11px] text-white transition hover:bg-[#374151]"
                                  >
                                    {m.name}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          ) : tab === "linked" ? (
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
              <p className="mb-3 px-1 text-[12px] text-[#6b7280]">
                같은 읍면·시군구로 자주 연결된 산
              </p>
              {topMountains.length === 0 ? (
                <p className="text-sm text-[#9ca3af]">표시할 산이 없습니다.</p>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {topMountains.map((m) => (
                    <button
                      key={m.id || m.name}
                      type="button"
                      onClick={() => openMountain(m)}
                      className="rounded-2xl bg-[#f9fafb] px-3 py-3 text-center ring-1 ring-[#eef2f6] transition hover:bg-white hover:ring-[#d1d5db]"
                    >
                      <MountainGlyph />
                      <p className="mt-2 truncate text-sm font-semibold text-[#111827]">
                        {m.name}
                      </p>
                      <p className="mt-0.5 text-[11px] text-[#6b7280]">
                        {m.height && m.height > 0
                          ? `${m.height.toLocaleString()} m`
                          : "고도 미상"}
                      </p>
                      <p className="mt-1 text-[11px] font-medium text-[#e03131]">
                        {m.fire_count > 0 ? `${m.fire_count}건` : "이력 없음"}
                      </p>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
              <p className="mb-3 px-1 text-[12px] text-[#6b7280]">
                전국 산 정보(
                {province.mountain_count?.toLocaleString()}개 중 대표)
              </p>
              {catalog.length === 0 ? (
                <p className="text-sm text-[#9ca3af]">등록된 산이 없습니다.</p>
              ) : (
                <ul className="space-y-2">
                  {catalog.map((m) => (
                    <li key={m.id || m.name}>
                      <button
                        type="button"
                        onClick={() => openMountain(m)}
                        className="flex w-full items-center gap-3 rounded-xl bg-[#f9fafb] px-3 py-3 text-left ring-1 ring-[#eef2f6] transition hover:bg-white hover:ring-[#d1d5db]"
                      >
                        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-[#e5e7eb] text-[#6b7280]">
                          <svg
                            viewBox="0 0 24 24"
                            className="h-5 w-5"
                            fill="currentColor"
                            aria-hidden
                          >
                            <path d="M3 18h18l-5.5-8-3.2 4.6L9.5 10 3 18z" />
                          </svg>
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-baseline justify-between gap-2">
                            <span className="truncate font-semibold text-[#111827]">
                              {m.name}
                            </span>
                            <span className="shrink-0 text-[11px] text-[#6b7280]">
                              {m.height && m.height > 0
                                ? `${m.height.toLocaleString()} m`
                                : "—"}
                            </span>
                          </span>
                          <span className="mt-0.5 block truncate text-[12px] text-[#6b7280]">
                            {m.address || "주소 없음"}
                            {m.fire_count > 0
                              ? ` · ${m.fire_count}건`
                              : ""}
                          </span>
                        </span>
                        <span className="text-[#9ca3af]" aria-hidden>
                          ›
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className="shrink-0 border-t border-[#e5e7eb] px-5 py-2.5 text-[11px] leading-relaxed text-[#9ca3af]">
            산 정보는 전국 산 목록 기준입니다. 발생 읍면(없으면 시군구)과
            산소재지가 같은 산을 연결하며, 발화 봉우리 확정이 아닙니다.
          </div>
        </>
      )}
    </aside>
  );
}
