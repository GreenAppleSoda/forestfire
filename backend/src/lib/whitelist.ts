import type {
  DailyRiskDto,
  JsonObject,
  MlScoresDto,
  WeatherSource,
} from "../types.js";

function asObject(value: unknown): JsonObject | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as JsonObject;
}

function publicWeatherSource(raw: unknown): WeatherSource {
  const s = String(raw || "").toLowerCase();
  if (s.startsWith("kma")) return "kma";
  if (s.startsWith("open_meteo")) return "open_meteo";
  if (s.startsWith("cli") || s === "manual") return "manual";
  if (s.startsWith("local")) return "local";
  return "unknown";
}

/** 브라우저로 내보낼 당일/시나리오 예측 DTO (화이트리스트) */
export function whitelistDailyRisk(raw: unknown): DailyRiskDto | null {
  const obj = asObject(raw);
  if (!obj) return null;

  const metrics = asObject(obj.model_metrics) ?? asObject(obj.metrics) ?? {};
  const sample = asObject(obj.sample_weather) ?? {};
  const isScenario = Boolean(obj.scenario_summary);
  const regions = Array.isArray(obj.regions) ? obj.regions : [];

  return {
    predict_date: obj.predict_date ?? null,
    weather_source: publicWeatherSource(obj.weather_source),
    sample_weather: {
      temp_avg: (sample.temp_avg as number | null | undefined) ?? null,
      temp_min: (sample.temp_min as number | null | undefined) ?? null,
      temp_max: (sample.temp_max as number | null | undefined) ?? null,
      precip: (sample.precip as number | null | undefined) ?? null,
      wind_avg: (sample.wind_avg as number | null | undefined) ?? null,
      wind_max: (sample.wind_max as number | null | undefined) ?? null,
      humidity_avg: (sample.humidity_avg as number | null | undefined) ?? null,
      humidity_min: (sample.humidity_min as number | null | undefined) ?? null,
    },
    n_regions:
      typeof obj.n_regions === "number" ? obj.n_regions : regions.length,
    note: isScenario
      ? String(obj.note || "가정 시나리오 예측 확률 (실제 예보 아님)")
      : "당일 시군구 산불 발생 예측 확률 (지도 색은 정규화 점수)",
    scenario_summary: isScenario ? String(obj.scenario_summary) : undefined,
    model_metrics:
      metrics.roc_auc != null || metrics.pr_auc != null
        ? {
            roc_auc: metrics.roc_auc ?? null,
            pr_auc: metrics.pr_auc ?? null,
          }
        : undefined,
    regions: regions.map((item) => {
      const r = asObject(item) ?? {};
      return {
        code: String(r.code ?? ""),
        name: r.name,
        province: r.province,
        ml_risk: r.ml_risk,
        ml_risk_norm: r.ml_risk_norm,
        humidity_min: r.humidity_min,
        temp_avg: r.temp_avg,
        precip: r.precip,
        wind_avg: r.wind_avg,
      };
    }),
  };
}

export function whitelistMlScores(raw: unknown): MlScoresDto | null {
  const obj = asObject(raw);
  if (!obj) return null;

  const metrics = asObject(obj.metrics) ?? asObject(obj.model_metrics) ?? {};
  const regions = Array.isArray(obj.regions) ? obj.regions : [];

  return {
    model: obj.model ?? "xgboost",
    test_start: obj.test_start,
    note: String(obj.note || "시군구 ML 위험 점수"),
    metrics:
      metrics.roc_auc != null
        ? { roc_auc: metrics.roc_auc, pr_auc: metrics.pr_auc }
        : undefined,
    regions: regions.map((item) => {
      const r = asObject(item) ?? {};
      return {
        code: String(r.code ?? ""),
        name: r.name,
        province: r.province,
        ml_risk: r.ml_risk,
        ml_risk_norm: r.ml_risk_norm,
      };
    }),
  };
}

export function whitelistMapData(raw: unknown): JsonObject | null {
  const obj = asObject(raw);
  if (!obj) return null;
  const meta = asObject(obj.meta) ?? {};

  return {
    meta: {
      source: "wildfire-atlas",
      unit: meta.unit,
      color: meta.color,
      total_fires: meta.total_fires,
      total_mountains: meta.total_mountains,
      matched_fires: meta.matched_fires,
      regions: meta.regions,
      regions_with_fires: meta.regions_with_fires,
    },
    provinces: obj.provinces ?? [],
    regions: obj.regions ?? [],
    history: obj.history ?? {},
    mountains: obj.mountains ?? {},
  };
}

export function whitelistAdmin(raw: unknown): JsonObject | null {
  const obj = asObject(raw);
  if (!obj) return null;
  const meta = asObject(obj.meta) ?? {};

  return {
    level: obj.level,
    viewBox: obj.viewBox,
    regions: obj.regions,
    markers: obj.markers,
    meta: {
      n_regions: meta.n_regions,
      n_markers: meta.n_markers,
      max_fire_count: meta.max_fire_count,
      prob_note: meta.prob_note,
    },
  };
}
