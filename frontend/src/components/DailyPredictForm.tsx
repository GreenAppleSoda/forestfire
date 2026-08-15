"use client";

import type { AdminLevel, DailyMlRisk, SigunguMlRegion } from "@/lib/types";
import { useMemo } from "react";

type Props = {
  daily?: DailyMlRisk | null;
  loading?: boolean;
  error?: string | null;
  /** 지도에서 클릭한 행정구역 코드 */
  selectedCode?: string | null;
  selectedName?: string | null;
  selectedLevel?: AdminLevel;
  onRefresh: () => void;
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
    label: "전국",
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
      label: name || "시도",
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

function RefreshIcon({ spinning }: { spinning?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`h-3.5 w-3.5 ${spinning ? "animate-spin" : ""}`}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M21 12a9 9 0 1 1-2.2-5.8" />
      <path d="M21 3v6h-6" />
    </svg>
  );
}

function observedLabel(daily: DailyMlRisk | null | undefined): string {
  const stamp = daily?.observed_at?.trim() || daily?.predict_date?.trim();
  return stamp ? `관측일 : ${stamp}` : "관측일 : —";
}

function WxRow({
  label,
  value,
  unit,
}: {
  label: string;
  value: string;
  unit?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-[11px] text-[#6b7280]">{label}</span>
      <span className="text-[12px] font-semibold tabular-nums text-[#111827]">
        {value}
        {unit ? (
          <span className="ml-0.5 text-[10px] font-medium text-[#6b7280]">
            {unit}
          </span>
        ) : null}
      </span>
    </div>
  );
}

export function DailyPredictForm({
  daily,
  loading,
  error,
  selectedCode,
  selectedName,
  selectedLevel,
  onRefresh,
}: Props) {
  const weather = useMemo(
    () => resolveRegionWeather(daily, selectedCode, selectedName, selectedLevel),
    [daily, selectedCode, selectedName, selectedLevel],
  );

  const fmt = (v: number | null | undefined, digits = 1) =>
    v == null || Number.isNaN(v) ? "—" : v.toFixed(digits);

  const title = weather?.label
    ? `${weather.label} 현재 기상`
    : "현재 기상";

  return (
    <div className="pointer-events-auto w-[176px] rounded-xl bg-white px-3 py-2.5 shadow-[var(--shadow-card)] ring-1 ring-[#e5e7eb]">
      <div className="flex items-start justify-between gap-1">
        <p className="min-w-0 text-[11px] font-semibold leading-snug text-[#111827]">
          {title}
        </p>
        <button
          type="button"
          disabled={loading}
          onClick={onRefresh}
          title="강제 새로고침"
          aria-label="강제 새로고침"
          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[#6b7280] ring-1 ring-[#e5e7eb] transition hover:bg-[#f9fafb] hover:text-[#111827] disabled:opacity-50"
        >
          <RefreshIcon spinning={loading} />
        </button>
      </div>
      <p className="mt-1 text-[10px] tabular-nums text-[#9ca3af]">
        {observedLabel(daily)}
      </p>
      <p className="mt-2 text-[22px] font-bold leading-none tabular-nums text-[#111827]">
        {fmt(weather?.temp_avg)}
        <span className="ml-0.5 text-[12px] font-semibold text-[#6b7280]">
          °C
        </span>
      </p>
      <div className="mt-2 space-y-0.5">
        <WxRow label="습도" value={fmt(weather?.humidity_avg, 0)} unit="%" />
        <WxRow label="강수" value={fmt(weather?.precip)} unit="mm" />
        <WxRow label="풍속" value={fmt(weather?.wind_avg)} unit="m/s" />
      </div>
      {error ? (
        <p className="mt-1.5 text-[10px] leading-snug text-[#e03131]">{error}</p>
      ) : null}
    </div>
  );
}
