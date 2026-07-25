"use client";

import type { AdminRegion, MountainInfo, RegionStat, RiskMode } from "@/lib/types";
import { MountainDetail } from "./MountainDetail";

type Props = {
  mountain: MountainInfo;
  mapRegion?: RegionStat | null;
  adminRegion?: AdminRegion | null;
  historyProb?: number | null;
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
  historyProb,
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
      : historyProb ?? (mapRegion ? mapRegion.risk_score / 100 : null);

  const modeLabel =
    riskMode === "daily"
      ? "당일 예측 "
      : riskMode === "scenario"
        ? "시나리오 예측 "
        : "이력 기반 확률 ";

  return (
    <div className="flex h-full flex-col bg-[#F7F4EF]">
      <div className="shrink-0 border-b border-[#e7e5e4] px-5 py-4">
        <button
          type="button"
          onClick={onBack}
          className="text-[11px] font-medium tracking-[0.14em] text-[#78716c] uppercase hover:text-[#1c1917]"
        >
          ← 검색 닫기
        </button>
        <p className="mt-2 text-[11px] tracking-[0.14em] text-[#78716c] uppercase">
          산 검색 결과
        </p>
        <h2 className="mt-1 font-[family-name:var(--font-display)] text-2xl text-[#1c1917]">
          {mountain.name}
        </h2>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="space-y-3 border-b border-[#e7e5e4] px-5 py-4">
          <p className="text-[11px] font-medium tracking-[0.14em] text-[#78716c] uppercase">
            위치 · 산불 위험 예측
          </p>
          {regionName ? (
            <div className="rounded-lg border border-[#d6d3d1] bg-white px-3 py-3 text-sm">
              <p className="font-medium text-[#1c1917]">
                {regionName}
                {province ? (
                  <span className="ml-1.5 text-xs font-normal text-[#78716c]">
                    {province}
                  </span>
                ) : null}
              </p>
              <p className="mt-2">
                <span className="text-[#78716c]">{modeLabel}</span>
                <span className="font-semibold text-[#b91c1c]">
                  {display != null ? `${(display * 100).toFixed(1)}%` : "—"}
                </span>
              </p>
              {(riskMode === "daily" || riskMode === "scenario") &&
                predictLoading && (
                <p className="mt-0.5 text-[11px] text-[#78716c]">
                  {riskMode === "scenario" ? "시나리오 예측 중…" : "기상청 관측 조회 중…"}
                </p>
              )}
              {(riskMode === "daily" || riskMode === "scenario") &&
                predictDate &&
                !predictLoading && (
                <p className="mt-0.5 text-[11px] text-[#a8a29e]">
                  예측일 {predictDate}
                  {weatherSource ? ` · ${weatherSource}` : ""}
                </p>
              )}
              {predictError && (
                <p className="mt-0.5 text-[11px] text-[#b91c1c]">{predictError}</p>
              )}
              <div className="mt-1.5 space-y-0.5 text-[12px] text-[#57534e]">
                {historyProb != null && (
                  <p>이력 확률 {(historyProb * 100).toFixed(1)}%</p>
                )}
                {(riskMode === "daily" || riskMode === "scenario") &&
                  mlRiskRaw != null && (
                  <p>모델 발생 확률 {(mlRiskRaw * 100).toFixed(1)}%</p>
                )}
                {mapRegion && (
                  <p>
                    지역 산불 {mapRegion.fire_count}건 · 등록 산{" "}
                    {mapRegion.mountain_count ?? 0}개
                  </p>
                )}
                <p>
                  이 산 · 같은 읍면·시군구 산불 {mountain.fire_count}건
                </p>
              </div>
              {onFocusRegion && adminRegion && (
                <button
                  type="button"
                  onClick={onFocusRegion}
                  className="mt-3 w-full rounded-md border border-[#d6d3d1] bg-[#fafaf9] px-3 py-2 text-xs font-medium text-[#1c1917] hover:bg-white"
                >
                  지도에서 해당 시군구 선택
                </button>
              )}
              <p className="mt-2 text-[10px] leading-snug text-[#a8a29e]">
                {mountain.svg_x != null
                  ? "지도 핀: 카카오 지오코딩 좌표"
                  : "지도 핀은 산 좌표가 없어 주소 기준 읍면동·시군구 중심에 표시됩니다."}
              </p>
            </div>
          ) : (
            <p className="text-sm text-[#a8a29e]">
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
