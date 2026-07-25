"use client";

import type { AdminLevel, DailyMlRisk, SigunguMlRegion } from "@/lib/types";
import { useMemo, useState } from "react";

type Props = {
  onPredicted: (data: DailyMlRisk) => void;
  daily?: DailyMlRisk | null;
  /** 지도에서 클릭한 행정구역 코드 */
  selectedCode?: string | null;
  selectedName?: string | null;
  selectedLevel?: AdminLevel;
  busy?: boolean;
};

type Wx = {
  label: string;
  temp_avg?: number | null;
  humidity_min?: number | null;
  precip?: number | null;
  wind_avg?: number | null;
};

function fmtWx(wx: Wx): string {
  const parts: string[] = [];
  if (wx.temp_avg != null && !Number.isNaN(wx.temp_avg)) {
    parts.push(`기온 ${wx.temp_avg}℃`);
  }
  if (wx.humidity_min != null && !Number.isNaN(wx.humidity_min)) {
    parts.push(`최저습도 ${wx.humidity_min}%`);
  }
  if (wx.precip != null && !Number.isNaN(wx.precip)) {
    parts.push(`강수 ${wx.precip}mm`);
  }
  if (wx.wind_avg != null && !Number.isNaN(wx.wind_avg)) {
    parts.push(`풍속 ${wx.wind_avg}m/s`);
  }
  return parts.join(" · ");
}

function avgField(
  rows: SigunguMlRegion[],
  key: "temp_avg" | "humidity_min" | "precip" | "wind_avg",
): number | null {
  const vals = rows
    .map((r) => r[key])
    .filter((v): v is number => typeof v === "number" && !Number.isNaN(v));
  if (!vals.length) return null;
  return Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10;
}

function resolveRegionWeather(
  daily: DailyMlRisk | null | undefined,
  code: string | null | undefined,
  name: string | null | undefined,
  level: AdminLevel | undefined,
): Wx | null {
  if (!daily?.regions?.length) return null;

  const sample = daily.sample_weather;
  const sampleWx = (): Wx => ({
    label: "전국 요약",
    temp_avg: sample?.temp_avg ?? null,
    humidity_min: sample?.humidity_min ?? null,
    precip: sample?.precip ?? null,
    wind_avg: sample?.wind_avg ?? null,
  });

  if (!code) return sampleWx();

  if (level === "sido") {
    const kids = daily.regions.filter(
      (r) => r.province === name || r.province?.includes(name || ""),
    );
    if (!kids.length) return sampleWx();
    return {
      label: name ? `${name} 평균` : "시도 평균",
      temp_avg: avgField(kids, "temp_avg"),
      humidity_min: avgField(kids, "humidity_min"),
      precip: avgField(kids, "precip"),
      wind_avg: avgField(kids, "wind_avg"),
    };
  }

  const sgCode = code.length >= 5 ? code.slice(0, 5) : code;
  const hit = daily.regions.find((r) => String(r.code) === sgCode);
  if (!hit) return sampleWx();

  return {
    label: hit.name || name || sgCode,
    temp_avg: hit.temp_avg ?? null,
    humidity_min: hit.humidity_min ?? null,
    precip: hit.precip ?? null,
    wind_avg: hit.wind_avg ?? null,
  };
}

export function DailyPredictForm({
  onPredicted,
  daily,
  selectedCode,
  selectedName,
  selectedLevel,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetchNote, setFetchNote] = useState<string | null>(null);

  const weather = useMemo(
    () => resolveRegionWeather(daily, selectedCode, selectedName, selectedLevel),
    [daily, selectedCode, selectedName, selectedLevel],
  );

  const run = async (force = false) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/predict/daily", {
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
      setFetchNote(
        [
          data.predict_date ? `관측일 ${data.predict_date}` : null,
          data.weather_source || null,
          json.cached ? "캐시" : "신규 조회",
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

  const statusLine = useMemo(() => {
    if (fetchNote) return fetchNote;
    if (!daily?.predict_date) return null;
    return [daily.predict_date ? `관측일 ${daily.predict_date}` : null, daily.weather_source || null]
      .filter(Boolean)
      .join(" · ");
  }, [fetchNote, daily]);

  const wxLine = weather ? fmtWx(weather) : null;

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
      {(statusLine || weather) && (
        <div className="mt-1.5 space-y-0.5 text-[10px] leading-snug text-[#78716c]">
          {statusLine && <p>{statusLine}</p>}
          {weather && wxLine && (
            <p>
              <span className="font-medium text-[#57534e]">{weather.label}</span>
              {" · "}
              {wxLine}
            </p>
          )}
          {daily && !selectedCode && (
            <p className="text-[#a8a29e]">지도를 클릭하면 해당 지역 기상이 표시됩니다.</p>
          )}
        </div>
      )}
      {error && (
        <p className="mt-1.5 text-[10px] leading-snug text-[#b91c1c]">{error}</p>
      )}
    </div>
  );
}
