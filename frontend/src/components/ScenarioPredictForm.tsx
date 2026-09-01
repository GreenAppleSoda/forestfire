"use client";

import type { DailyMlRisk } from "@/lib/types";
import { readApiJson } from "@/lib/apiJson";
import { useEffect, useMemo, useRef, useState } from "react";

type Props = {
  onPredicted: (data: DailyMlRisk) => void;
};

type WeatherSliders = {
  temp_avg: number;
  humidity_avg: number;
  wind_avg: number;
  precip: number;
};

/** DB 조회 전·실패 시 슬라이더 폴백 */
const FALLBACK_BASELINE: Record<number, WeatherSliders> = {
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

const PRESETS: { id: string; label: string }[] = [
  { id: "normal", label: "평년" },
  { id: "dry_windy", label: "건조·강풍" },
  { id: "hot_dry", label: "고온·건조" },
  { id: "wet", label: "습함·비 많음" },
];

/** DB 실패 시에만 평년 폴백에 더함 */
const FALLBACK_DELTAS: Record<string, WeatherSliders> = {
  normal: { temp_avg: 0, humidity_avg: 0, wind_avg: 0, precip: 0 },
  dry_windy: { temp_avg: 0, humidity_avg: -20, wind_avg: 3.5, precip: -1 },
  hot_dry: { temp_avg: 5, humidity_avg: -25, wind_avg: 0, precip: -1 },
  wet: { temp_avg: 0, humidity_avg: 15, wind_avg: 0, precip: 12 },
};

const PRESET_NOTES: Record<string, string> = {
  dry_windy: "습도·강수 하위 10% · 바람 상위 10%",
  hot_dry: "기온 상위 10% · 습도·강수 하위 10%",
  wet: "습도·강수 상위 10%",
};

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function clampWeather(w: WeatherSliders): WeatherSliders {
  return {
    temp_avg: clamp(w.temp_avg, -10, 38),
    humidity_avg: clamp(w.humidity_avg, 15, 95),
    wind_avg: clamp(w.wind_avg, 0.5, 12),
    precip: clamp(Math.max(0, w.precip), 0, 40),
  };
}

function applyFallbackPreset(base: WeatherSliders, presetId: string): WeatherSliders {
  const d = FALLBACK_DELTAS[presetId] ?? FALLBACK_DELTAS.normal;
  return clampWeather({
    temp_avg: base.temp_avg + d.temp_avg,
    humidity_avg: base.humidity_avg + d.humidity_avg,
    wind_avg: base.wind_avg + d.wind_avg,
    precip: Math.max(0, base.precip + d.precip),
  });
}

function weatherFromPreset(
  presets: Record<string, WeatherSliders> | null,
  base: WeatherSliders,
  presetId: string,
): WeatherSliders {
  const fromDb = presets?.[presetId];
  if (fromDb) return clampWeather(fromDb);
  return applyFallbackPreset(base, presetId);
}

function parseWeather(raw: WeatherSliders | undefined): WeatherSliders | null {
  if (!raw) return null;
  const w: WeatherSliders = {
    temp_avg: Number(raw.temp_avg),
    humidity_avg: Number(raw.humidity_avg),
    wind_avg: Number(raw.wind_avg),
    precip: Number(raw.precip),
  };
  if (
    ![w.temp_avg, w.humidity_avg, w.wind_avg, w.precip].every(Number.isFinite)
  ) {
    return null;
  }
  return w;
}

function fallbackFor(month: number): WeatherSliders {
  return FALLBACK_BASELINE[month] ?? FALLBACK_BASELINE[3];
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

type BaselineMeta = {
  source: string;
  start_date?: string | null;
  end_date?: string | null;
  n_years?: number;
};

export function ScenarioPredictForm({ onPredicted }: Props) {
  const initial = defaultYearMonth();
  const [year, setYear] = useState(initial.year);
  const [month, setMonth] = useState(initial.month);
  const [presetId, setPresetId] = useState("normal");
  const [baseline, setBaseline] = useState<WeatherSliders>(() =>
    fallbackFor(initial.month),
  );
  const [presets, setPresets] = useState<Record<string, WeatherSliders> | null>(
    null,
  );
  const [baselineMeta, setBaselineMeta] = useState<BaselineMeta | null>(null);
  const [weather, setWeather] = useState<WeatherSliders>(() =>
    applyFallbackPreset(fallbackFor(initial.month), "normal"),
  );
  const [loading, setLoading] = useState(false);
  const [baselineLoading, setBaselineLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const presetIdRef = useRef(presetId);
  presetIdRef.current = presetId;
  const baselineCache = useRef<
    Record<
      number,
      {
        weather: WeatherSliders;
        presets: Record<string, WeatherSliders>;
        meta: BaselineMeta;
      }
    >
  >({});

  useEffect(() => {
    let cancelled = false;

    const applyLoaded = (
      base: WeatherSliders,
      nextPresets: Record<string, WeatherSliders> | null,
      meta: BaselineMeta | null,
    ) => {
      setBaseline(base);
      setPresets(nextPresets);
      setBaselineMeta(meta);
      setWeather(weatherFromPreset(nextPresets, base, presetIdRef.current));
    };

    const cached = baselineCache.current[month];
    if (cached) {
      applyLoaded(cached.weather, cached.presets, cached.meta);
      setBaselineLoading(false);
      return () => {
        cancelled = true;
      };
    }

    setBaselineLoading(true);
    applyLoaded(fallbackFor(month), null, null);

    void (async () => {
      try {
        const res = await fetch(
          `/api/predict/scenario/baseline?month=${month}`,
        );
        const json = await readApiJson<{
          ok?: boolean;
          error?: string;
          data?: {
            weather?: WeatherSliders;
            presets?: Record<string, WeatherSliders>;
            source?: string;
            start_date?: string | null;
            end_date?: string | null;
            n_years?: number;
          };
        }>(res);
        if (cancelled) return;
        const weatherIn = parseWeather(json.data?.weather);
        if (!res.ok || !json.ok || !weatherIn) return;
        const parsedPresets: Record<string, WeatherSliders> = {};
        for (const [id, value] of Object.entries(json.data?.presets ?? {})) {
          const w = parseWeather(value);
          if (w) parsedPresets[id] = w;
        }
        if (!parsedPresets.normal) parsedPresets.normal = weatherIn;
        const meta: BaselineMeta = {
          source: json.data?.source || "weather_daily_sigungu",
          start_date: json.data?.start_date,
          end_date: json.data?.end_date,
          n_years: json.data?.n_years,
        };
        baselineCache.current[month] = {
          weather: weatherIn,
          presets: parsedPresets,
          meta,
        };
        applyLoaded(weatherIn, parsedPresets, meta);
      } catch {
        /* 폴백 유지 */
      } finally {
        if (!cancelled) setBaselineLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [month]);

  const summary = useMemo(
    () =>
      `${year}년 ${month}월 가정 · 기온 ${weather.temp_avg.toFixed(1)}℃ · 습도 ${weather.humidity_avg.toFixed(0)}% · 풍속 ${weather.wind_avg.toFixed(1)}m/s · 강수 ${weather.precip.toFixed(1)}mm`,
    [year, month, weather],
  );

  const baselineNote = useMemo(() => {
    if (baselineMeta?.source !== "weather_daily_sigungu") return null;
    const y0 = baselineMeta.start_date?.slice(0, 4);
    const y1 = baselineMeta.end_date?.slice(0, 4);
    const span = y0 && y1 ? `${y0}–${y1}년 ${month}월` : `${month}월`;
    const years =
      typeof baselineMeta.n_years === "number"
        ? ` · ${baselineMeta.n_years}개년`
        : "";
    if (presetId === "normal" || presetId === "custom") {
      return `평년: DB ${span} 평균${years}`;
    }
    const extra = PRESET_NOTES[presetId];
    return extra ? `DB ${span}${years} · ${extra}` : `DB ${span}${years}`;
  }, [baselineMeta, month, presetId]);

  const setYearMonth = (y: number, m: number) => {
    setYear(y);
    setMonth(m);
    setPresetId("normal");
  };

  const pickPreset = (id: string) => {
    setPresetId(id);
    setWeather(weatherFromPreset(presets, baseline, id));
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
      {baselineLoading ? (
        <p className="mt-0.5 text-[9px] leading-snug text-[#9ca3af]">
          DB 월 분포 불러오는 중…
        </p>
      ) : baselineNote ? (
        <p className="mt-0.5 text-[9px] leading-snug text-[#9ca3af]">
          {baselineNote}
        </p>
      ) : null}

      <button
        type="button"
        disabled={loading}
        onClick={() => void run()}
        className="mt-2 w-full rounded-xl bg-[#111827] px-2 py-2.5 text-[12px] font-semibold text-white disabled:opacity-50"
      >
        {loading ? "시나리오 예측 중…" : "시나리오 예측"}
      </button>

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
