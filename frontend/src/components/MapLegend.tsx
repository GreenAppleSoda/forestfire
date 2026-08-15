import { RISK_BAND_COLORS, RISK_TICKS } from "@/lib/choropleth";
import type { RiskMode } from "@/lib/types";

type Props = {
  mode?: RiskMode;
  auc?: number;
  predictDate?: string;
};

export function MapLegend({ mode = "history", auc, predictDate }: Props) {
  const isPredict = mode === "daily" || mode === "scenario";
  const hint = isPredict
    ? `0~100 · 10단계 · ${predictDate ?? "—"} · AUC ${auc != null ? auc.toFixed(2) : "—"}`
    : "같은 행정 레벨 안에서 과거 산불 건수를 비교 · 스크롤: 시도 → 시군구 → 읍면동";

  return (
    <div className="w-[300px] rounded-2xl bg-white px-4 py-3.5 shadow-[var(--shadow-card)] ring-1 ring-[#e5e7eb]">
      <p className="text-[12px] font-medium leading-snug text-[#6b7280]">
        {isPredict ? "산불위험지수 (0~100)" : "산불 발생 빈도 · 과거 이력"}
      </p>

      {isPredict ? (
        <>
          <div className="mt-3 flex h-3 w-full overflow-hidden rounded-sm">
            {RISK_BAND_COLORS.map((c) => (
              <div
                key={c}
                className="h-full flex-1"
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
          <div className="mt-1 flex w-full justify-between text-[9px] tabular-nums leading-none text-[#6b7280]">
            {RISK_TICKS.map((t) => (
              <span key={t}>{t}</span>
            ))}
          </div>
        </>
      ) : (
        <>
          <div className="mt-3 flex h-2.5 w-full overflow-hidden rounded-full">
            {RISK_BAND_COLORS.map((c) => (
              <div
                key={c}
                className="h-full flex-1"
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
          <div className="mt-1.5 flex w-full justify-between text-[11px] text-[#6b7280]">
            <span>적음</span>
            <span>보통</span>
            <span>많음</span>
          </div>
        </>
      )}
      <p className="mt-2 text-[10px] leading-relaxed text-[#9ca3af]">{hint}</p>
    </div>
  );
}
