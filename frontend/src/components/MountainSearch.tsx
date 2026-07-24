"use client";

import type { MountainInfo } from "@/lib/types";
import { searchMountains } from "@/lib/mountainSearch";
import { useEffect, useMemo, useRef, useState } from "react";

type Props = {
  mountainIndex?: Record<string, MountainInfo>;
  onSelect: (mountain: MountainInfo) => void;
};

export function MountainSearch({ mountainIndex, onSelect }: Props) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const results = useMemo(
    () => searchMountains(mountainIndex, query, 15),
    [mountainIndex, query],
  );

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  return (
    <div ref={wrapRef} className="relative w-full max-w-sm">
      <label className="sr-only" htmlFor="mountain-search">
        산 검색
      </label>
      <div className="flex items-center gap-2 rounded-lg border border-[#d6d3d1] bg-white/95 px-3 py-2 shadow-sm backdrop-blur-sm">
        <span className="text-[11px] font-medium tracking-[0.12em] text-[#78716c] uppercase">
          산 검색
        </span>
        <input
          id="mountain-search"
          type="search"
          value={query}
          placeholder="예: 북한산"
          autoComplete="off"
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          className="min-w-0 flex-1 bg-transparent text-sm text-[#1c1917] outline-none placeholder:text-[#a8a29e]"
        />
        {query && (
          <button
            type="button"
            className="text-xs text-[#78716c] hover:text-[#1c1917]"
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
        <ul className="absolute top-full right-0 left-0 z-50 mt-1 max-h-72 overflow-y-auto rounded-lg border border-[#d6d3d1] bg-white shadow-lg">
          {results.length === 0 ? (
            <li className="px-3 py-3 text-sm text-[#a8a29e]">
              검색 결과가 없습니다
            </li>
          ) : (
            results.map((m) => (
              <li key={m.id || m.name}>
                <button
                  type="button"
                  className="flex w-full flex-col items-start gap-0.5 border-b border-[#f5f5f4] px-3 py-2.5 text-left last:border-0 hover:bg-[#fafaf9]"
                  onClick={() => {
                    onSelect(m);
                    setQuery(m.name);
                    setOpen(false);
                  }}
                >
                  <span className="text-sm font-medium text-[#1c1917]">
                    {m.name}
                  </span>
                  <span className="line-clamp-1 text-[11px] text-[#78716c]">
                    {m.address || "주소 없음"}
                    {m.fire_count > 0 ? ` · 같은 지역 산불 ${m.fire_count}건` : ""}
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
