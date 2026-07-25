import { ABS_COLOR_FOCUS, riskLegendGradient } from "@/lib/choropleth";
import type { RiskMode } from "@/lib/types";

type Props = {
  mode?: RiskMode;
  auc?: number;
  predictDate?: string;
};

export function MapLegend({ mode = "history", auc, predictDate }: Props) {
  const title =
    mode === "daily"
      ? "당일 예측 위험 (지역 색)"
      : mode === "scenario"
        ? "사용자 지정 시나리오 (지역 색)"
        : "산불 위험 · 이력 기반";
  const focusPct = Math.round(ABS_COLOR_FOCUS * 100);
  const hint =
    mode === "daily" || mode === "scenario"
      ? `절대 확률 · 색은 0~${focusPct}% 구간을 촘촘히 표시 · ${predictDate ?? "—"} · AUC ${auc != null ? auc.toFixed(2) : "—"}`
      : "스크롤: 시도 → 시군구 → 읍면동 · 읍면동에서 굵은 선=시군구";

  return (
    <div className="rounded-lg border border-[#d6d3d1] bg-white/90 px-4 py-3 backdrop-blur-sm">
      <p className="mb-2 text-[11px] font-medium tracking-[0.14em] text-[#78716c] uppercase">
        {title}
      </p>
      <div
        className="h-2.5 w-52 rounded-sm"
        style={{ background: riskLegendGradient() }}
      />
      <div className="mt-1.5 flex w-52 justify-between text-[11px] text-[#57534e]">
        <span>0%</span>
        <span>15%</span>
        <span>30%</span>
        <span>{focusPct}%+</span>
      </div>
      <p className="mt-2 text-[10px] leading-relaxed text-[#a8a29e]">{hint}</p>
    </div>
  );
}
