"use client";

import type { MountainInfo } from "@/lib/types";
import { searchMountains } from "@/lib/mountainSearch";
import { useEffect, useMemo, useRef, useState } from "react";

type Props = {
  mountainIndex?: Record<string, MountainInfo>;
  onSelect: (mountain: MountainInfo) => void;
  variant?: "default" | "sidebar";
};

export function MountainSearch({
  mountainIndex,
  onSelect,
  variant = "default",
}: Props) {
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

  const sidebar = variant === "sidebar";

  return (
    <div ref={wrapRef} className="relative w-full">
      <label className="sr-only" htmlFor="mountain-search">
        산 검색
      </label>
      <div
        className={`flex items-center gap-2 bg-white ${
          sidebar
            ? "rounded-xl px-3 py-2.5 ring-1 ring-[#e5e7eb]"
            : "rounded-lg border border-[#e5e7eb] px-3 py-2 shadow-sm"
        }`}
      >
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
          id="mountain-search"
          type="search"
          value={query}
          placeholder={sidebar ? "지역명을 검색하세요" : "예: 북한산"}
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
            results.map((m) => (
              <li key={m.id || m.name}>
                <button
                  type="button"
                  className="flex w-full flex-col items-start gap-0.5 border-b border-[#f3f4f6] px-3 py-2.5 text-left last:border-0 hover:bg-[#f9fafb]"
                  onClick={() => {
                    onSelect(m);
                    setQuery(m.name);
                    setOpen(false);
                  }}
                >
                  <span className="text-sm font-medium text-[#111827]">
                    {m.name}
                  </span>
                  <span className="line-clamp-1 text-[11px] text-[#6b7280]">
                    {m.address || "주소 없음"}
                    {m.fire_count > 0
                      ? ` · 같은 지역 산불 ${m.fire_count}건`
                      : ""}
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
