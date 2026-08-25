"use client";

import type {
  AdminLevel,
  AdminRegion,
  FireEvent,
  MountainInfo,
  RiskMode,
} from "@/lib/types";
import { formatRegionPath } from "@/lib/legalDong";
import { PlaceSearch } from "./PlaceSearch";

type Props = {
  riskMode: RiskMode;
  predictLoading?: boolean;
  mountainIndex?: Record<string, MountainInfo>;
  sidoRegions?: AdminRegion[];
  sigunguRegions?: AdminRegion[];
  recentFires?: FireEvent[];
  onSelectMountain: (mountain: MountainInfo) => void;
  onSelectRegion: (region: AdminRegion, level: AdminLevel) => void;
  onSelectFire?: (ev: FireEvent) => void;
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
  { id: "history", label: "산불 이력" },
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
  recentFires,
  onSelectMountain,
  onSelectRegion,
  onSelectFire,
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
      <div className="shrink-0 border-b border-[#e5e7eb] px-3.5 pt-4 pb-3.5">
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={onGoHome}
            className="flex min-w-0 flex-1 items-center gap-3 text-left transition hover:opacity-90"
            aria-label="홈으로 돌아가기"
            title="홈으로"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/logo-chatbot-circle.png"
              alt=""
              className="h-16 w-16 shrink-0 object-contain"
            />
            <span className="flex min-w-0 flex-col justify-center">
              <span className="whitespace-nowrap font-[family-name:var(--font-display)] text-[15px] leading-none font-bold tracking-[0.14em] text-[#1a3d2c]">
                FORESTFIRE ATLAS
              </span>
              <span className="mt-1.5 flex w-full items-center gap-1.5 text-[9px] leading-none font-medium tracking-[0.46em] text-[#1a3d2c]">
                <span className="h-px flex-1 bg-[#1a3d2c]/30" aria-hidden />
                KOREA
                <span className="h-px flex-1 bg-[#1a3d2c]/30" aria-hidden />
              </span>
            </span>
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

        <div className="mt-3.5">
          <PlaceSearch
            mountainIndex={mountainIndex}
            sido={sidoRegions}
            sigungu={sigunguRegions}
            onSelectMountain={onSelectMountain}
            onSelectRegion={onSelectRegion}
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 py-4">
        <p className="px-1 text-[11px] font-semibold tracking-[0.12em] text-[#9ca3af] uppercase">
          카테고리
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

        {recentFires && recentFires.length > 0 && (
          <div className="mt-4">
            <p className="px-1 text-[11px] font-semibold tracking-[0.12em] text-[#9ca3af] uppercase">
              최근 산불 발생
            </p>
            <ul className="mt-2 space-y-1.5">
              {recentFires.map((ev, i) => (
                <li key={`${ev.datetime}-${ev.region}-${i}`}>
                  <button
                    type="button"
                    onClick={() => onSelectFire?.(ev)}
                    className="w-full rounded-lg bg-[#fafafa] px-3 py-2 text-left ring-1 ring-[#f0f0f0] transition hover:bg-[#fff1f0] hover:ring-[#fecaca]"
                  >
                    <div className="flex items-start gap-2">
                      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded bg-[#fff1f0] text-[#e03131]">
                        <svg viewBox="0 0 24 24" className="h-3 w-3" fill="currentColor" aria-hidden>
                          <path d="M12 2c.4 2.2-.3 3.8-1.4 5.2-.9 1.1-1.6 2-1.6 3.4 0 1.7 1.2 3 2.8 3.4-.6-1.3-.4-2.5.5-3.6 1.2-1.5 2.9-2.4 3.5-4.6.8 1.4 1.2 2.8 1.2 4.3 0 4.3-3 7.9-7 7.9S3 16.1 3 11.8C3 7.6 6.2 4.2 12 2z" />
                        </svg>
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[12px] font-medium text-[#111827]">
                          {formatRegionPath(ev.region)}
                        </p>
                        <p className="mt-0.5 text-[10px] text-[#9ca3af]">
                          {ev.datetime?.slice(0, 10) || "—"}
                        </p>
                      </div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

    </aside>
  );
}
