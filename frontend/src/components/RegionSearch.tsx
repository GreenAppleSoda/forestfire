"use client";

import type { AdminLevel, AdminRegion } from "@/lib/types";
import {
  regionSearchSubtitle,
  searchRegions,
} from "@/lib/regionSearch";
import { useEffect, useMemo, useRef, useState } from "react";

type Props = {
  sido?: AdminRegion[];
  sigungu?: AdminRegion[];
  onSelect: (region: AdminRegion, level: AdminLevel) => void;
};

export function RegionSearch({ sido, sigungu, onSelect }: Props) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const results = useMemo(
    () => searchRegions(sido, sigungu, query, 15),
    [sido, sigungu, query],
  );

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  return (
    <div ref={wrapRef} className="relative w-full">
      <label className="sr-only" htmlFor="region-search">
        지역 검색
      </label>
      <div className="flex items-center gap-2 rounded-xl bg-white px-3 py-2.5 ring-1 ring-[#e5e7eb]">
        <svg
          className="h-4 w-4 shrink-0 text-[#9ca3af]"
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
          id="region-search"
          type="search"
          value={query}
          placeholder="지역명을 검색하세요"
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

      {open && query.trim() && (
        <ul className="absolute top-full right-0 left-0 z-50 mt-1.5 max-h-72 overflow-y-auto rounded-xl bg-white shadow-lg ring-1 ring-[#e5e7eb]">
          {results.length === 0 ? (
            <li className="px-3 py-3 text-sm text-[#9ca3af]">
              검색 결과가 없습니다
            </li>
          ) : (
            results.map((hit) => (
              <li key={`${hit.level}-${hit.region.code}`}>
                <button
                  type="button"
                  className="flex w-full flex-col items-start gap-0.5 border-b border-[#f3f4f6] px-3 py-2.5 text-left last:border-0 hover:bg-[#f9fafb]"
                  onClick={() => {
                    onSelect(hit.region, hit.level);
                    setQuery(hit.region.name);
                    setOpen(false);
                  }}
                >
                  <span className="text-sm font-medium text-[#111827]">
                    {hit.region.name}
                  </span>
                  <span className="line-clamp-1 text-[11px] text-[#6b7280]">
                    {regionSearchSubtitle(hit)}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
