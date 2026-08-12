"use client";

import type { MountainInfo } from "@/lib/types";

type Props = {
  mountain: MountainInfo;
  onBack: () => void;
};

function formatHeight(height: number | null | undefined) {
  if (height == null || Number.isNaN(height) || height <= 0) return null;
  return `${height.toLocaleString()} m`;
}

export function MountainDetail({
  mountain,
  onBack,
  hideBack,
}: Props & { hideBack?: boolean }) {
  const height = formatHeight(mountain.height);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-start justify-between gap-4 border-b border-[#e5e7eb] px-5 py-5">
        <div>
          {!hideBack && (
            <button
              type="button"
              onClick={onBack}
              className="text-[11px] font-medium tracking-[0.14em] text-[#6b7280] uppercase transition hover:text-[#111827]"
            >
              ← 목록으로
            </button>
          )}
          <h2
            className={`font-[family-name:var(--font-display)] text-2xl tracking-tight text-[#111827] ${hideBack ? "" : "mt-2"}`}
          >
            {mountain.name}
          </h2>
          <div className="mt-2 flex flex-wrap gap-2 text-xs text-[#4b5563]">
            {height && (
              <span className="rounded-full bg-[#f3f4f6] px-2.5 py-1">
                고도 {height}
              </span>
            )}
            {mountain.fire_count > 0 && (
              <span className="rounded-full bg-[#fff1f0] px-2.5 py-1 text-[#e03131]">
                같은 읍면·시군구 산불 {mountain.fire_count}건
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5 text-sm leading-relaxed text-[#4b5563]">
        {mountain.address && (
          <section>
            <p className="text-[11px] font-medium tracking-[0.14em] text-[#9ca3af] uppercase">
              소재지
            </p>
            <p className="mt-1.5 text-[#111827]">{mountain.address}</p>
          </section>
        )}

        {mountain.notable && (
          <section>
            <p className="text-[11px] font-medium tracking-[0.14em] text-[#9ca3af] uppercase">
              명산 소개
            </p>
            <p className="mt-1.5 whitespace-pre-wrap">{mountain.notable}</p>
          </section>
        )}

        {mountain.details && (
          <section>
            <p className="text-[11px] font-medium tracking-[0.14em] text-[#9ca3af] uppercase">
              산 정보
            </p>
            <p className="mt-1.5 whitespace-pre-wrap">{mountain.details}</p>
          </section>
        )}

        {!mountain.details && !mountain.notable && (
          <p className="text-[#9ca3af]">등록된 상세 설명이 없습니다.</p>
        )}

        {(mountain.admin || mountain.admin_tel) && (
          <section className="rounded-xl bg-[#f9fafb] px-3 py-3 ring-1 ring-[#e5e7eb]">
            <p className="text-[11px] font-medium tracking-[0.14em] text-[#9ca3af] uppercase">
              관리 기관
            </p>
            <p className="mt-1.5 text-[#111827]">
              {mountain.admin}
              {mountain.admin_tel ? ` · ${mountain.admin_tel}` : ""}
            </p>
          </section>
        )}
      </div>
    </div>
  );
}

export function MountainChip({
  mountain,
  onSelect,
}: {
  mountain: MountainInfo;
  onSelect: (m: MountainInfo) => void;
}) {
  const height = formatHeight(mountain.height);
  return (
    <button
      type="button"
      onClick={() => onSelect(mountain)}
      className="inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-left text-[12px] text-[#111827] ring-1 ring-[#e5e7eb] transition hover:bg-[#f9fafb]"
    >
      <span>{mountain.name}</span>
      {height && <span className="text-[10px] text-[#6b7280]">{height}</span>}
      {mountain.fire_count > 0 && (
        <span className="text-[10px] text-[#e03131]">{mountain.fire_count}</span>
      )}
    </button>
  );
}
