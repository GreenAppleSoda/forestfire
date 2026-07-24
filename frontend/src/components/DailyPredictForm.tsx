"use client";

import type { DailyMlRisk } from "@/lib/types";
import { useState } from "react";

type Props = {
  onPredicted: (data: DailyMlRisk) => void;
  busy?: boolean;
};

export function DailyPredictForm({ onPredicted }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [meta, setMeta] = useState<string | null>(null);

  const run = async (force = false) => {
    setLoading(true);
    setError(null);
    setMeta(null);
    try {
      const res = await fetch("/api/predict", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: "kma", force }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json.error || "예측 요청 실패");
      }
      const data = json.data as DailyMlRisk;
      onPredicted(data);
      const wx = data.sample_weather;
      const wxLine = wx
        ? `기온 ${wx.temp_avg}℃ · 최저습도 ${wx.humidity_min}% · 강수 ${wx.precip}mm · 풍속 ${wx.wind_avg}m/s`
        : null;
      setMeta(
        [
          data.predict_date ? `관측일 ${data.predict_date}` : null,
          data.weather_source || null,
          json.cached ? "캐시" : "신규 조회",
          wxLine,
        ]
          .filter(Boolean)
          .join(" · "),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="pointer-events-auto w-72 rounded-lg border border-[#d6d3d1] bg-white/95 px-3 py-2.5 text-sm shadow-sm backdrop-blur-sm">
      <p className="text-[11px] font-medium tracking-[0.12em] text-[#78716c] uppercase">
        기상청 ASOS 실시간
      </p>
      <p className="mt-1 text-[11px] leading-snug text-[#57534e]">
        종관기상관측 시간자료로 오늘 날씨를 불러와 시군구별 산불 확률을
        계산합니다.
      </p>
      <button
        type="button"
        disabled={loading}
        onClick={() => run(false)}
        className="mt-2 w-full rounded-md bg-[#1c1917] px-2 py-1.5 text-[11px] font-medium text-white disabled:opacity-50"
      >
        {loading ? "기상 조회·예측 중…" : "실시간 기상으로 예측"}
      </button>
      <button
        type="button"
        disabled={loading}
        onClick={() => run(true)}
        className="mt-1 w-full rounded-md border border-[#d6d3d1] bg-[#fafaf9] px-2 py-1 text-[10px] font-medium text-[#57534e] disabled:opacity-50"
      >
        강제 새로고침
      </button>
      {meta && (
        <p className="mt-1.5 text-[10px] leading-snug text-[#78716c]">{meta}</p>
      )}
      {error && (
        <p className="mt-1.5 text-[10px] leading-snug text-[#b91c1c]">{error}</p>
      )}
    </div>
  );
}
