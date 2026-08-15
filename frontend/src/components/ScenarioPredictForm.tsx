"use client";

import type { DailyMlRisk } from "@/lib/types";
import { readApiJson } from "@/lib/apiJson";
import { useMemo, useState } from "react";

type Props = {
  onPredicted: (data: DailyMlRisk) => void;
};

type WeatherSliders = {
  temp_avg: number;
  humidity_avg: number;
  wind_avg: number;
  precip: number;
};

const MONTH_BASELINE: Record<number, WeatherSliders> = {
  1: { temp_avg: 0, humidity_avg: 58, wind_avg: 2.4, precip: 0.8 },
  2: { temp_avg: 2, humidity_avg: 56, wind_avg: 2.6, precip: 1.0 },
  3: { temp_avg: 7.5, humidity_avg: 55, wind_avg: 2.8, precip: 1.5 },
  4: { temp_avg: 13.5, humidity_avg: 54, wind_avg: 2.7, precip: 2.5 },
  5: { temp_avg: 18.5, humidity_avg: 58, wind_avg: 2.4, precip: 3.0 },
  6: { temp_avg: 22.5, humidity_avg: 68, wind_avg: 2.2, precip: 5.5 },
  7: { temp_avg: 25.5, humidity_avg: 76, wind_avg: 2.1, precip: 9.0 },
  8: { temp_avg: 26, humidity_avg: 74, wind_avg: 2.2, precip: 8.0 },
  9: { temp_avg: 21.5, humidity_avg: 68, wind_avg: 2.3, precip: 4.5 },
  10: { temp_avg: 15, humidity_avg: 62, wind_avg: 2.4, precip: 2.0 },
  11: { temp_avg: 8, humidity_avg: 60, wind_avg: 2.5, precip: 1.5 },
  12: { temp_avg: 2, humidity_avg: 58, wind_avg: 2.5, precip: 1.0 },
};

const PRESETS: { id: string; label: string; deltas: WeatherSliders }[] = [
  { id: "normal", label: "평년", deltas: { temp_avg: 0, humidity_avg: 0, wind_avg: 0, precip: 0 } },
  {
    id: "dry_windy",
    label: "건조·강풍",
    deltas: { temp_avg: 2, humidity_avg: -20, wind_avg: 3.5, precip: -1 },
  },
  {
    id: "hot_dry",
    label: "고온·건조",
    deltas: { temp_avg: 5, humidity_avg: -25, wind_avg: 1.5, precip: -1 },
  },
  {
    id: "wet",
    label: "습함·비 많음",
    deltas: { temp_avg: -1, humidity_avg: 15, wind_avg: -0.5, precip: 12 },
  },
];

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function applyPreset(month: number, presetId: string): WeatherSliders {
  const base = MONTH_BASELINE[month] ?? MONTH_BASELINE[3];
  const preset = PRESETS.find((p) => p.id === presetId) ?? PRESETS[0];
  return {
    temp_avg: clamp(base.temp_avg + preset.deltas.temp_avg, -10, 38),
    humidity_avg: clamp(base.humidity_avg + preset.deltas.humidity_avg, 15, 95),
    wind_avg: clamp(base.wind_avg + preset.deltas.wind_avg, 0.5, 12),
    precip: clamp(Math.max(0, base.precip + preset.deltas.precip), 0, 40),
  };
}

function addMonths(year: number, month: number, offset: number) {
  const total = year * 12 + (month - 1) + offset;
  return { year: Math.floor(total / 12), month: (total % 12) + 1 };
}

function yearMonthKey(year: number, month: number) {
  return `${year}-${String(month).padStart(2, "0")}`;
}

function defaultYearMonth() {
  const d = new Date();
  return addMonths(d.getFullYear(), d.getMonth() + 1, 1);
}

const YEAR_MONTH_OPTIONS = (() => {
  const d = new Date();
  const startYear = d.getFullYear();
  const startMonth = d.getMonth() + 1;
  return Array.from({ length: 12 }, (_, i) => addMonths(startYear, startMonth, i));
})();

export function ScenarioPredictForm({ onPredicted }: Props) {
  const initial = defaultYearMonth();
  const [year, setYear] = useState(initial.year);
  const [month, setMonth] = useState(initial.month);
  const [presetId, setPresetId] = useState("normal");
  const [weather, setWeather] = useState<WeatherSliders>(() =>
    applyPreset(initial.month, "normal"),
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const summary = useMemo(
    () =>
      `${year}년 ${month}월 가정 · 기온 ${weather.temp_avg.toFixed(1)}℃ · 습도 ${weather.humidity_avg.toFixed(0)}% · 풍속 ${weather.wind_avg.toFixed(1)}m/s · 강수 ${weather.precip.toFixed(1)}mm`,
    [year, month, weather],
  );

  const setYearMonth = (y: number, m: number) => {
    setYear(y);
    setMonth(m);
    setPresetId("normal");
    setWeather(applyPreset(m, "normal"));
  };

  const pickPreset = (id: string) => {
    setPresetId(id);
    setWeather(applyPreset(month, id));
  };

  const patchSlider = (key: keyof WeatherSliders, value: number) => {
    setPresetId("custom");
    setWeather((prev) => ({ ...prev, [key]: value }));
  };

  const run = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/predict/scenario", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          year,
          month,
          weather: {
            temp_avg: weather.temp_avg,
            humidity_avg: weather.humidity_avg,
            wind_avg: weather.wind_avg,
            precip: weather.precip,
          },
        }),
      });
      const json = await readApiJson(res);
      if (!res.ok || !json.ok) {
        throw new Error(json.error || "시나리오 예측 실패");
      }
      const data = json.data as DailyMlRisk;
      onPredicted(data);
      setNote(data.scenario_summary || summary);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="pointer-events-auto w-[280px] rounded-2xl bg-white px-4 py-3.5 text-sm shadow-[var(--shadow-card)] ring-1 ring-[#e5e7eb]">
      <p className="text-[12px] font-semibold text-[#111827]">
        사용자 지정 시나리오
      </p>
      <p className="mt-1 text-[11px] leading-snug text-[#6b7280]">
        연·월과 날씨 가정을 정하면 시군구별 산불 발생 확률을 계산합니다. 실제
        예보가 아닙니다.
      </p>

      <label className="mt-2 flex flex-col gap-0.5 text-[10px] text-[#6b7280]">
        연도/월
        <select
          className="rounded-xl border border-[#e5e7eb] bg-white px-1.5 py-1.5 text-[11px] text-[#111827]"
          value={yearMonthKey(year, month)}
          onChange={(e) => {
            const [y, m] = e.target.value.split("-").map(Number);
            setYearMonth(y, m);
          }}
        >
          {YEAR_MONTH_OPTIONS.map((opt) => (
            <option key={yearMonthKey(opt.year, opt.month)} value={yearMonthKey(opt.year, opt.month)}>
              {opt.year}/{String(opt.month).padStart(2, "0")}
            </option>
          ))}
        </select>
      </label>

      <p className="mt-2 text-[10px] font-medium text-[#6b7280]">날씨 느낌</p>
      <div className="mt-1 flex flex-wrap gap-1">
        {PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => pickPreset(p.id)}
            className={`rounded-lg px-2 py-0.5 text-[10px] font-medium transition ${
              presetId === p.id
                ? "bg-[#111827] text-white"
                : "bg-[#f9fafb] text-[#4b5563] ring-1 ring-[#e5e7eb] hover:bg-[#f3f4f6]"
            }`}
          >
            {p.label}
          </button>
        ))}
        {presetId === "custom" && (
          <span className="rounded-lg bg-[#f3f4f6] px-2 py-0.5 text-[10px] text-[#6b7280]">
            커스텀
          </span>
        )}
      </div>

      <div className="mt-2 space-y-2">
        <SliderRow
          label="기온"
          left="추움"
          right="더움"
          value={weather.temp_avg}
          min={-10}
          max={38}
          step={0.5}
          display={`${weather.temp_avg.toFixed(1)}℃`}
          onChange={(v) => patchSlider("temp_avg", v)}
        />
        <SliderRow
          label="습도"
          left="건조"
          right="습함"
          value={weather.humidity_avg}
          min={15}
          max={95}
          step={1}
          display={`${weather.humidity_avg.toFixed(0)}%`}
          onChange={(v) => patchSlider("humidity_avg", v)}
        />
        <SliderRow
          label="바람"
          left="약함"
          right="강함"
          value={weather.wind_avg}
          min={0.5}
          max={12}
          step={0.1}
          display={`${weather.wind_avg.toFixed(1)}m/s`}
          onChange={(v) => patchSlider("wind_avg", v)}
        />
        <SliderRow
          label="강수"
          left="거의 없음"
          right="많음"
          value={weather.precip}
          min={0}
          max={40}
          step={0.5}
          display={`${weather.precip.toFixed(1)}mm`}
          onChange={(v) => patchSlider("precip", v)}
        />
      </div>

      <p className="mt-2 text-[10px] leading-snug text-[#6b7280]">{summary}</p>

      <button
        type="button"
        disabled={loading}
        onClick={() => void run()}
        className="mt-2 w-full rounded-xl bg-[#111827] px-2 py-2.5 text-[12px] font-semibold text-white disabled:opacity-50"
      >
        {loading ? "시나리오 예측 중…" : "이 가정으로 예측"}
      </button>

      {note && !error && (
        <p className="mt-1.5 text-[10px] leading-snug text-[#4b5563]">{note}</p>
      )}
      {error && (
        <p className="mt-1.5 text-[10px] leading-snug text-[#e03131]">{error}</p>
      )}
    </div>
  );
}

function SliderRow({
  label,
  left,
  right,
  value,
  min,
  max,
  step,
  display,
  onChange,
}: {
  label: string;
  left: string;
  right: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between text-[10px] text-[#6b7280]">
        <span className="font-medium text-[#4b5563]">{label}</span>
        <span className="tabular-nums text-[#111827]">{display}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-0.5 w-full accent-[#111827]"
      />
      <div className="flex justify-between text-[9px] text-[#9ca3af]">
        <span>{left}</span>
        <span>{right}</span>
      </div>
    </div>
  );
}
