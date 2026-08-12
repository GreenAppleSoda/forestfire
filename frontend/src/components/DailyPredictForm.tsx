"use client";

import type { AdminLevel, DailyMlRisk, SigunguMlRegion } from "@/lib/types";
import { readApiJson } from "@/lib/apiJson";
import { useMemo, useState } from "react";

type Props = {
  onPredicted: (data: DailyMlRisk) => void;
  daily?: DailyMlRisk | null;
  /** 지도에서 클릭한 행정구역 코드 */
  selectedCode?: string | null;
  selectedName?: string | null;
  selectedLevel?: AdminLevel;
};

type Wx = {
  label: string;
  temp_avg?: number | null;
  humidity_avg?: number | null;
  precip?: number | null;
  wind_avg?: number | null;
};

function avgField(
  rows: SigunguMlRegion[],
  key: "temp_avg" | "humidity_avg" | "precip" | "wind_avg",
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
    humidity_avg: sample?.humidity_avg ?? null,
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
      humidity_avg: avgField(kids, "humidity_avg"),
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
    humidity_avg: hit.humidity_avg ?? null,
    precip: hit.precip ?? null,
    wind_avg: hit.wind_avg ?? null,
  };
}

function WxStat({
  label,
  value,
  unit,
}: {
  label: string;
  value: string;
  unit?: string;
}) {
  return (
    <div className="rounded-xl bg-[#f9fafb] px-2.5 py-2">
      <p className="text-[10px] font-medium text-[#9ca3af]">{label}</p>
      <p className="mt-0.5 text-[15px] font-semibold tabular-nums text-[#111827]">
        {value}
        {unit ? (
          <span className="ml-0.5 text-[11px] font-medium text-[#6b7280]">
            {unit}
          </span>
        ) : null}
      </p>
    </div>
  );
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
      const json = await readApiJson(res);
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
    return [
      daily.predict_date ? `관측일 ${daily.predict_date}` : null,
      daily.weather_source || null,
    ]
      .filter(Boolean)
      .join(" · ");
  }, [fetchNote, daily]);

  const fmt = (v: number | null | undefined, digits = 1) =>
    v == null || Number.isNaN(v) ? "—" : v.toFixed(digits);

  return (
    <div className="pointer-events-auto w-[280px] rounded-2xl bg-white px-4 py-3.5 shadow-[var(--shadow-card)] ring-1 ring-[#e5e7eb]">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[12px] font-semibold text-[#111827]">실시간 기상</p>
        {statusLine ? (
          <p className="truncate text-[10px] text-[#9ca3af]">{statusLine}</p>
        ) : null}
      </div>
      {weather ? (
        <p className="mt-1 text-[11px] text-[#6b7280]">{weather.label}</p>
      ) : (
        <p className="mt-1 text-[11px] text-[#9ca3af]">
          예측을 실행하면 기상이 표시됩니다.
        </p>
      )}

      <div className="mt-3 grid grid-cols-2 gap-2">
        <WxStat label="기온" value={fmt(weather?.temp_avg)} unit="°C" />
        <WxStat label="습도" value={fmt(weather?.humidity_avg, 0)} unit="%" />
        <WxStat label="강수" value={fmt(weather?.precip)} unit="mm" />
        <WxStat label="풍속" value={fmt(weather?.wind_avg)} unit="m/s" />
      </div>

      <button
        type="button"
        disabled={loading}
        onClick={() => run(false)}
        className="mt-3 w-full rounded-xl bg-[#111827] px-3 py-2.5 text-[12px] font-semibold text-white transition hover:bg-[#1f2937] disabled:opacity-50"
      >
        {loading ? "기상 조회·예측 중…" : "실시간 기상으로 예측"}
      </button>
      <button
        type="button"
        disabled={loading}
        onClick={() => run(true)}
        className="mt-1.5 w-full rounded-xl px-3 py-1.5 text-[11px] font-medium text-[#6b7280] ring-1 ring-[#e5e7eb] transition hover:bg-[#f9fafb] disabled:opacity-50"
      >
        강제 새로고침
      </button>
      {daily && !selectedCode && (
        <p className="mt-2 text-[10px] leading-snug text-[#9ca3af]">
          지도를 클릭하면 해당 지역 기상이 표시됩니다.
        </p>
      )}
      {error && (
        <p className="mt-2 text-[10px] leading-snug text-[#e03131]">{error}</p>
      )}
    </div>
  );
}
