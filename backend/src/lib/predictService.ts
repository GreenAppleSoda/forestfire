import { PREDICT_CACHE_MS } from "../config.js";
import type {
  DailyRiskDto,
  PredictDailyBody,
  PredictResult,
  PredictScenarioBody,
} from "../types.js";
import { callFlaskPredict, callFlaskScenario } from "./mlClient.js";
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
