import { PREDICT_CACHE_MS } from "../config.js";
import type {
  DailyRiskDto,
  PredictDailyBody,
  PredictResult,
  PredictScenarioBody,
  ScenarioBaselineDto,
  ScenarioBaselineWeather,
} from "../types.js";
import { callFlaskPredict, callFlaskScenario, callFlaskScenarioBaseline } from "./mlClient.js";
import { saveDailyMlRiskToFile } from "./riskSnapshot.js";
import { whitelistDailyRisk } from "./whitelist.js";

type PredictCache = { at: number; data: DailyRiskDto | null };

let predictCache: PredictCache | null = null;
let predictInFlight: Promise<PredictResult> | null = null;

function setPredictCache(data: DailyRiskDto | null): void {
  predictCache = { at: Date.now(), data };
}

export async function runPredictScenario(
  body: PredictScenarioBody,
): Promise<PredictResult> {
  const year = Number(body.year);
  const month = Number(body.month);
  if (!Number.isFinite(year) || !Number.isFinite(month)) {
    return { ok: false, error: "연도와 월을 입력해 주세요.", status: 400 };
  }

  const { status, json } = await callFlaskScenario({
    year,
    month,
    weather: body.weather,
    preset: body.preset,
  });

  if (!json.ok || status >= 400) {
    console.error(
      "[predict/scenario] ml-service error",
      status,
      json.error,
      json.detail,
    );
    return {
      ok: false,
      error: "시나리오 예측에 실패했습니다. 잠시 후 다시 시도해 주세요.",
      status: 502,
    };
  }

  return {
    ok: true,
    data: whitelistDailyRisk(json.data),
    cached: false,
    status: 200,
  };
}

function parseWeather(raw: unknown): ScenarioBaselineWeather | null {
  if (!raw || typeof raw !== "object") return null;
  const w = raw as Record<string, unknown>;
  const temp = Number(w.temp_avg);
  const humidity = Number(w.humidity_avg);
  const wind = Number(w.wind_avg);
  const precip = Number(w.precip);
  if (![temp, humidity, wind, precip].every(Number.isFinite)) return null;
  return {
    temp_avg: temp,
    humidity_avg: humidity,
    wind_avg: wind,
    precip: precip,
  };
}

export async function getScenarioBaseline(month: number): Promise<
  | { ok: true; data: ScenarioBaselineDto; status: 200 }
  | { ok: false; error: string; status: number }
> {
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    return { ok: false, error: "월을 입력해 주세요.", status: 400 };
  }

  const { status, json } = await callFlaskScenarioBaseline(month);
  const raw = json.data;
  if (!json.ok || status >= 400 || !raw || typeof raw !== "object") {
    console.error(
      "[predict/scenario/baseline] ml-service error",
      status,
      json.error,
      json.detail,
    );
    return {
      ok: false,
      error: "평년 기상을 불러오지 못했습니다.",
      status: 502,
    };
  }

  const obj = raw as Record<string, unknown>;
  const weather = parseWeather(obj.weather);
  if (!weather) {
    return {
      ok: false,
      error: "평년 기상을 불러오지 못했습니다.",
      status: 502,
    };
  }

  const presets: Record<string, ScenarioBaselineWeather> = {};
  if (obj.presets && typeof obj.presets === "object") {
    for (const [id, value] of Object.entries(
      obj.presets as Record<string, unknown>,
    )) {
      const parsed = parseWeather(value);
      if (parsed) presets[id] = parsed;
    }
  }
  if (!presets.normal) presets.normal = weather;

  const data: ScenarioBaselineDto = {
    month: Number(obj.month) || month,
    weather,
    presets,
    source: typeof obj.source === "string" ? obj.source : "fallback",
    start_date: typeof obj.start_date === "string" ? obj.start_date : null,
    end_date: typeof obj.end_date === "string" ? obj.end_date : null,
    n_rows: typeof obj.n_rows === "number" ? obj.n_rows : undefined,
    n_years: typeof obj.n_years === "number" ? obj.n_years : undefined,
  };

  return { ok: true, data, status: 200 };
}

export async function runPredictDaily(
  body: PredictDailyBody,
): Promise<PredictResult> {
  const source = body.source || "kma";
  const force = Boolean(body.force);
  const hasManual =
    typeof body.temp_avg === "number" ||
    (body.weather != null && typeof body.weather.temp_avg === "number");

  if (
    !force &&
    !hasManual &&
    source === "kma" &&
    predictCache &&
    Date.now() - predictCache.at < PREDICT_CACHE_MS
  ) {
    return {
      ok: true,
      data: predictCache.data,
      cached: true,
      status: 200,
    };
  }

  if (!force && !hasManual && source === "kma" && predictInFlight) {
    return predictInFlight;
  }

  const job = (async (): Promise<PredictResult> => {
    const { status, json } = await callFlaskPredict({
      source,
      force,
      date: body.date,
      weather: body.weather,
      temp_avg: body.temp_avg,
      precip: body.precip,
      wind_avg: body.wind_avg,
      humidity_avg: body.humidity_avg,
    });

    if (!json.ok || status >= 400) {
      console.error(
        "[predict/daily] ml-service error",
        status,
        json.error,
        json.detail,
      );
      return {
        ok: false,
        error: "예측에 실패했습니다. 잠시 후 다시 시도해 주세요.",
        status: 502,
      };
    }

    const data = whitelistDailyRisk(json.data);
    if (!hasManual && source === "kma") {
      setPredictCache(data);
      if (data) void saveDailyMlRiskToFile(data);
    }

    return { ok: true, data, cached: false, status: 200 };
  })().finally(() => {
    predictInFlight = null;
  });

  if (!hasManual && source === "kma") {
    predictInFlight = job;
  }

  return job;
}
