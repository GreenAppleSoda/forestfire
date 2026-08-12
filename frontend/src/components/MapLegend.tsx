import {
  ABS_COLOR_FOCUS,
  frequencyLegendGradient,
  riskLegendGradient,
} from "@/lib/choropleth";
import type { RiskMode } from "@/lib/types";

type Props = {
  mode?: RiskMode;
  auc?: number;
  predictDate?: string;
  /** 선택 지역 또는 요약 위험 확률 0~1 */
  riskValue?: number | null;
  riskTitle?: string;
};

export function MapLegend({
  mode = "history",
  auc,
  predictDate,
  riskValue,
  riskTitle,
}: Props) {
  const isPredict = mode === "daily" || mode === "scenario";
  const title =
    mode === "daily"
      ? "오늘의 산불 예측 위험"
      : mode === "scenario"
        ? "시나리오 예측 위험"
        : "산불 발생 빈도 · 과거 이력";
  const focusPct = Math.round(ABS_COLOR_FOCUS * 100);
  const midLow = (ABS_COLOR_FOCUS * 0.3 * 100).toFixed(1).replace(/\.0$/, "");
  const midHigh = (ABS_COLOR_FOCUS * 0.6 * 100).toFixed(1).replace(/\.0$/, "");
  const hint = isPredict
    ? `절대 확률 · 색은 0~${focusPct}% 구간 · ${predictDate ?? "—"} · AUC ${auc != null ? auc.toFixed(2) : "—"}`
    : "같은 행정 레벨 안에서 과거 산불 건수를 비교 · 스크롤: 시도 → 시군구 → 읍면동";

  return (
    <div className="w-[260px] rounded-2xl bg-white px-4 py-3.5 shadow-[var(--shadow-card)] ring-1 ring-[#e5e7eb]">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[12px] font-medium leading-snug text-[#6b7280]">
          {riskTitle ?? title}
        </p>
        {isPredict && riskValue != null && (
          <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#fee2e2] text-[11px] text-[#e03131]">
            !
          </span>
        )}
      </div>

      {isPredict && riskValue != null ? (
        <p className="mt-1 text-[1.75rem] font-bold tracking-tight text-[#e03131]">
          {(riskValue * 100).toFixed(1)}
          <span className="ml-0.5 text-lg">%</span>
        </p>
      ) : null}

      <div
        className="mt-3 h-2.5 w-full rounded-full"
        style={{
          background: isPredict
            ? riskLegendGradient()
            : frequencyLegendGradient(),
        }}
      />
      <div className="mt-1.5 flex w-full justify-between text-[11px] text-[#6b7280]">
        {isPredict ? (
          <>
            <span>0%</span>
            <span>{midLow}%</span>
            <span>{midHigh}%</span>
            <span>{focusPct}%+</span>
          </>
        ) : (
          <>
            <span>적음</span>
            <span>보통</span>
            <span>많음</span>
          </>
        )}
      </div>
      <p className="mt-2 text-[10px] leading-relaxed text-[#9ca3af]">{hint}</p>
    </div>
  );
}
