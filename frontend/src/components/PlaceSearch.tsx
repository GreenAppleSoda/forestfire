"use client";

import type { AdminLevel, AdminRegion, MountainInfo } from "@/lib/types";
import { searchMountains } from "@/lib/mountainSearch";
import { regionSearchSubtitle, searchRegions } from "@/lib/regionSearch";
import { useEffect, useMemo, useRef, useState } from "react";
import { MountainThumb } from "./MountainThumb";

type Props = {
  mountainIndex?: Record<string, MountainInfo>;
  sido?: AdminRegion[];
  sigungu?: AdminRegion[];
  onSelectMountain: (mountain: MountainInfo) => void;
  onSelectRegion: (region: AdminRegion, level: AdminLevel) => void;
};

type RegionHit = {
  kind: "region";
  level: AdminLevel;
  region: AdminRegion;
  subtitle: string;
};

type MountainHit = {
  kind: "mountain";
  mountain: MountainInfo;
};

export function PlaceSearch({
  mountainIndex,
  sido,
  sigungu,
  onSelectMountain,
  onSelectRegion,
}: Props) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const regionHits = useMemo<RegionHit[]>(
    () =>
      searchRegions(sido, sigungu, query, 8).map((hit) => ({
        kind: "region",
        level: hit.level,
        region: hit.region,
        subtitle: regionSearchSubtitle(hit),
      })),
    [sido, sigungu, query],
  );

  const mountainHits = useMemo<MountainHit[]>(
    () =>
      searchMountains(mountainIndex, query, 8).map((mountain) => ({
        kind: "mountain",
        mountain,
      })),
    [mountainIndex, query],
  );

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const hasQuery = Boolean(query.trim());
  const empty = hasQuery && regionHits.length === 0 && mountainHits.length === 0;

  return (
    <div ref={wrapRef} className="relative w-full">
      <label className="sr-only" htmlFor="place-search">
        지역 또는 산 검색
      </label>
      <div className="flex items-center gap-2 rounded-xl bg-[#f9fafb] px-3 py-2 ring-1 ring-[#e5e7eb] transition focus-within:bg-white focus-within:ring-[#2563eb]/45">
        <svg
          className="h-3.5 w-3.5 shrink-0 text-[#9ca3af]"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden
        >
          <circle cx="11" cy="11" r="7" />
          <path d="M20 20l-3.5-3.5" strokeLinecap="round" />
        </svg>
        <input
          id="place-search"
          type="search"
          value={query}
          placeholder="지역 또는 산을 검색하세요"
          autoComplete="off"
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          className="min-w-0 flex-1 bg-transparent text-sm text-[#111827] outline-none placeholder:text-[#9ca3af]"
        />
        {query && (
          <button
            type="button"
            className="text-xs text-[#6b7280] hover:text-[#111827]"
            onClick={() => {
              setQuery("");
              setOpen(false);
            }}
          >
            지우기
          </button>
        )}
      </div>

      {open && hasQuery && (
        <ul className="absolute top-full right-0 left-0 z-50 mt-1.5 max-h-80 overflow-y-auto rounded-xl bg-white shadow-lg ring-1 ring-[#e5e7eb]">
          {empty ? (
            <li className="px-3 py-3 text-sm text-[#9ca3af]">
              검색 결과가 없습니다
            </li>
          ) : (
            <>
              {regionHits.length > 0 && (
                <li className="px-3 pt-2 pb-1 text-[10px] font-semibold tracking-[0.08em] text-[#9ca3af] uppercase">
                  지역
                </li>
              )}
              {regionHits.map((hit) => (
                <li key={`r-${hit.level}-${hit.region.code}`}>
                  <button
                    type="button"
                    className="flex w-full flex-col items-start gap-0.5 border-b border-[#f3f4f6] px-3 py-2.5 text-left hover:bg-[#f9fafb]"
                    onClick={() => {
                      onSelectRegion(hit.region, hit.level);
                      setQuery(hit.region.name);
                      setOpen(false);
                    }}
                  >
                    <span className="text-sm font-medium text-[#111827]">
                      {hit.region.name}
                    </span>
                    <span className="line-clamp-1 text-[11px] text-[#6b7280]">
                      {hit.subtitle}
                    </span>
                  </button>
                </li>
              ))}
              {mountainHits.length > 0 && (
                <li className="px-3 pt-2 pb-1 text-[10px] font-semibold tracking-[0.08em] text-[#9ca3af] uppercase">
                  산
                </li>
              )}
              {mountainHits.map((hit) => (
                <li key={`m-${hit.mountain.id || hit.mountain.name}`}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2.5 border-b border-[#f3f4f6] px-3 py-2.5 text-left last:border-0 hover:bg-[#f9fafb]"
                    onClick={() => {
                      onSelectMountain(hit.mountain);
                      setQuery(hit.mountain.name);
                      setOpen(false);
                    }}
                  >
                    <MountainThumb
                      mountain={hit.mountain}
                      className="h-9 w-9"
                      rounded="rounded-md"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-[#111827]">
                        {hit.mountain.name}
                      </span>
                      <span className="line-clamp-1 text-[11px] text-[#6b7280]">
                        {hit.mountain.height && hit.mountain.height > 0
                          ? `${hit.mountain.height.toLocaleString()}m`
                          : "고도 미상"}
                        {hit.mountain.address
                          ? ` · ${hit.mountain.address}`
                          : ""}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </>
          )}
        </ul>
      )}
    </div>
  );
}
