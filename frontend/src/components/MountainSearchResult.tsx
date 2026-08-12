"use client";

import type { AdminRegion, MountainInfo, RegionStat, RiskMode } from "@/lib/types";
import { MountainDetail } from "./MountainDetail";

type Props = {
  mountain: MountainInfo;
  mapRegion?: RegionStat | null;
  adminRegion?: AdminRegion | null;
  mlRiskNorm?: number | null;
  mlRiskRaw?: number | null;
  riskMode: RiskMode;
  predictDate?: string;
  weatherSource?: string;
  predictLoading?: boolean;
  predictError?: string | null;
  onBack: () => void;
  onFocusRegion?: () => void;
};

export function MountainSearchResult({
  mountain,
  mapRegion,
  adminRegion,
  mlRiskNorm,
  mlRiskRaw,
  riskMode,
  predictDate,
  weatherSource,
  predictLoading,
  predictError,
  onBack,
  onFocusRegion,
}: Props) {
  const regionName = adminRegion?.name || mapRegion?.name;
  const province =
    adminRegion?.province_name ||
    adminRegion?.province ||
    mapRegion?.province_name ||
    mapRegion?.province;

  const display =
    riskMode === "daily" || riskMode === "scenario"
      ? (mlRiskRaw ?? mlRiskNorm)
      : null;

  const modeLabel =
    riskMode === "daily"
      ? "당일 산불위험지수"
      : riskMode === "scenario"
        ? "시나리오 산불위험지수"
        : null;

  const isPredict = riskMode === "daily" || riskMode === "scenario";

  return (
    <div className="flex h-full flex-col bg-white">
      <div className="shrink-0 border-b border-[#e5e7eb] px-5 py-4">
        <button
          type="button"
          onClick={onBack}
          className="text-[11px] font-medium tracking-[0.14em] text-[#6b7280] uppercase hover:text-[#111827]"
        >
          ← 검색 닫기
        </button>
        <p className="mt-2 text-[11px] tracking-[0.14em] text-[#9ca3af] uppercase">
          산 검색 결과
        </p>
        <h2 className="mt-1 font-[family-name:var(--font-display)] text-2xl text-[#111827]">
          {mountain.name}
        </h2>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="space-y-3 border-b border-[#e5e7eb] px-5 py-4">
          <p className="text-[11px] font-medium tracking-[0.14em] text-[#9ca3af] uppercase">
            위치 · 산불 위험 예측
          </p>
          {regionName ? (
            <div className="rounded-xl bg-[#f9fafb] px-3 py-3 text-sm ring-1 ring-[#e5e7eb]">
              <p className="font-medium text-[#111827]">
                {regionName}
                {province ? (
                  <span className="ml-1.5 text-xs font-normal text-[#6b7280]">
                    {province}
                  </span>
                ) : null}
              </p>
              <p className="mt-2">
                {modeLabel && display != null ? (
                  <>
                    <span className="block text-[11px] leading-snug text-[#6b7280]">
                      {modeLabel}
                    </span>
                    <span className="text-2xl font-bold text-[#e03131]">
                      {(display * 100).toFixed(1)}
                    </span>
                  </>
                ) : (
                  <>
                    <span className="block text-[11px] leading-snug text-[#6b7280]">
                      과거 산불 발생
                    </span>
                    <span className="text-2xl font-bold text-[#e03131]">
                      {(
                        adminRegion?.fire_count ??
                        mapRegion?.fire_count ??
                        0
                      ).toLocaleString()}
                    </span>
                    <span className="ml-1 text-[12px] text-[#6b7280]">건</span>
                  </>
                )}
              </p>
              {isPredict && predictLoading && (
                <p className="mt-0.5 text-[11px] text-[#6b7280]">
                  {riskMode === "scenario"
                    ? "시나리오 예측 중…"
                    : "기상청 관측 조회 중…"}
                </p>
              )}
              {isPredict && predictDate && !predictLoading && (
                <p className="mt-0.5 text-[11px] text-[#9ca3af]">
                  예측일 {predictDate}
                  {weatherSource ? ` · ${weatherSource}` : ""}
                </p>
              )}
              {predictError && (
                <p className="mt-0.5 text-[11px] text-[#e03131]">{predictError}</p>
              )}
              <div className="mt-1.5 space-y-0.5 text-[12px] text-[#4b5563]">
                {isPredict && mlRiskRaw != null && (
                  <p>산불위험지수 {(mlRiskRaw * 100).toFixed(1)} (raw×100)</p>
                )}
                {mapRegion && (
                  <p>
                    지역 산불 {mapRegion.fire_count}건 · 등록 산{" "}
                    {mapRegion.mountain_count ?? 0}개
                  </p>
                )}
                <p>이 산 · 같은 읍면·시군구 산불 {mountain.fire_count}건</p>
              </div>
              {onFocusRegion && adminRegion && (
                <button
                  type="button"
                  onClick={onFocusRegion}
                  className="mt-3 w-full rounded-xl bg-[#111827] px-3 py-2 text-xs font-medium text-white hover:bg-[#1f2937]"
                >
                  지도에서 해당 시군구 선택
                </button>
              )}
              <p className="mt-2 text-[10px] leading-snug text-[#9ca3af]">
                {mountain.svg_x != null
                  ? "지도 핀: 카카오 지도코드 좌표"
                  : "지도 핀은 산 좌표가 없어 주소 기준 읍면동·시군구 중심에 표시됩니다."}
              </p>
            </div>
          ) : (
            <p className="text-sm text-[#9ca3af]">
              연결된 시군구를 찾지 못했습니다. 산 정보만 표시합니다.
            </p>
          )}
        </div>

        <div className="h-[min(52vh,420px)]">
          <MountainDetail mountain={mountain} onBack={onBack} hideBack />
        </div>
      </div>
    </div>
  );
}
