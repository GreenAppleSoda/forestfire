"use client";

import type {
  AdminLevel,
  AdminRegion,
  MountainInfo,
  RiskMode,
} from "@/lib/types";
import type { ReactNode } from "react";
import { MountainSearch } from "./MountainSearch";
import { RegionSearch } from "./RegionSearch";

type Props = {
  riskMode: RiskMode;
  predictLoading?: boolean;
  mountainIndex?: Record<string, MountainInfo>;
  sidoRegions?: AdminRegion[];
  sigunguRegions?: AdminRegion[];
  syncSlot?: ReactNode;
  onSelectMountain: (mountain: MountainInfo) => void;
  onSelectRegion: (region: AdminRegion, level: AdminLevel) => void;
  onRiskMode: (mode: RiskMode) => void;
  onGoHome?: () => void;
  onCloseMobile?: () => void;
  mobile?: boolean;
};

const RISK_ACTIONS: {
  id: RiskMode;
  label: string;
  loadingLabel?: string;
}[] = [
  { id: "daily", label: "당일 예측", loadingLabel: "예측 중…" },
  { id: "scenario", label: "사용자 지정" },
  { id: "history", label: "과거 이력" },
];

function ModeButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full rounded-xl px-3.5 py-2.5 text-center text-[13px] font-medium transition ${
        active
          ? "bg-[#111827] text-white shadow-sm"
          : "bg-white text-[#374151] ring-1 ring-[#e5e7eb] hover:bg-[#f9fafb]"
      }`}
    >
      {label}
    </button>
  );
}

export function AppSidebar({
  riskMode,
  predictLoading,
  mountainIndex,
  sidoRegions,
  sigunguRegions,
  syncSlot,
  onSelectMountain,
  onSelectRegion,
  onRiskMode,
  onGoHome,
  onCloseMobile,
  mobile,
}: Props) {
  return (
    <aside
      className={`flex h-full w-[280px] shrink-0 flex-col border-r border-[#e5e7eb] bg-white ${
        mobile ? "shadow-xl" : ""
      }`}
    >
      <div className="shrink-0 border-b border-[#e5e7eb] px-4 pt-4 pb-4">
        <div className="flex items-start justify-between gap-2">
          <button
            type="button"
            onClick={onGoHome}
            className="min-w-0 flex-1 cursor-pointer text-left transition opacity-100 hover:opacity-90"
            aria-label="홈으로 돌아가기"
            title="홈으로"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/logo-forestfire-atlas.png"
              alt="Forestfire Atlas Korea"
              className="block h-auto w-full object-contain object-left"
            />
          </button>
          {onCloseMobile ? (
            <button
              type="button"
              onClick={onCloseMobile}
              className="rounded-lg px-2 py-1 text-sm text-[#6b7280] hover:bg-[#f3f4f6] hover:text-[#111827]"
              aria-label="메뉴 닫기"
            >
              ✕
            </button>
          ) : null}
        </div>

        <div className="mt-4 space-y-2">
          <MountainSearch
            mountainIndex={mountainIndex}
            onSelect={onSelectMountain}
            variant="sidebar"
          />
          <RegionSearch
            sido={sidoRegions}
            sigungu={sigunguRegions}
            onSelect={onSelectRegion}
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 py-4">
        <p className="px-1 text-[11px] font-semibold tracking-[0.12em] text-[#9ca3af] uppercase">
          위험 표시
        </p>
        {RISK_ACTIONS.map((a) => (
          <ModeButton
            key={a.id}
            active={riskMode === a.id}
            label={
              predictLoading && a.id === "daily" && riskMode === "daily"
                ? (a.loadingLabel ?? a.label)
                : a.label
            }
            onClick={() => onRiskMode(a.id)}
          />
        ))}
      </div>

      {syncSlot ? (
        <div className="shrink-0 border-t border-[#e5e7eb] px-4 py-3">
          {syncSlot}
        </div>
      ) : null}
    </aside>
  );
}
