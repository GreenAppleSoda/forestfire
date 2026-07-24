import { riskLegendGradient } from "@/lib/choropleth";
import type { RiskMode } from "@/lib/types";

type Props = {
  mode?: RiskMode;
  auc?: number;
  predictDate?: string;
};

export function MapLegend({ mode = "history", auc, predictDate }: Props) {
  const title =
    mode === "daily" ? "당일 예측 위험 (지역 색)" : "산불 위험 · 이력 기반";
  const hint =
    mode === "daily"
      ? `숫자는 발생 확률 · 색은 전국 상대 위험 · ${predictDate ?? "—"} · AUC ${auc != null ? auc.toFixed(2) : "—"}`
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
        <span>낮음</span>
        <span>높음</span>
      </div>
      <p className="mt-2 text-[10px] leading-relaxed text-[#a8a29e]">{hint}</p>
    </div>
  );
}
