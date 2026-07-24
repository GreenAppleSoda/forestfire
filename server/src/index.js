/**
 * ForestFire Express API — 공개 웹 백엔드
 * - 지도/산 JSON 서빙 (UI용 DTO)
 * - Flask ml-service 프록시 + 응답 화이트리스트
 */
import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
dotenv.config({ path: path.join(ROOT, "server", ".env") });

const PORT = Number(process.env.PORT || 4000);
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || "http://localhost:3000";
const ML_SERVICE_URL = (process.env.ML_SERVICE_URL || "http://127.0.0.1:5000").replace(
  /\/$/,
  "",
);
const PREDICT_CACHE_MS = Number(process.env.PREDICT_CACHE_MS || 30 * 60 * 1000);
const DATA_DIR = path.join(ROOT, "frontend", "public", "data");

const app = express();
app.use(
  cors({
    origin: FRONTEND_ORIGIN,
    methods: ["GET", "POST", "OPTIONS"],
  }),
);
app.use(express.json({ limit: "256kb" }));

/** @type {{ at: number, data: unknown } | null} */
let predictCache = null;

async function readJson(name) {
  const full = path.join(DATA_DIR, name);
  const raw = await fs.readFile(full, "utf-8");
  return JSON.parse(raw);
}

function publicWeatherSource(raw) {
  const s = String(raw || "").toLowerCase();
  if (s.startsWith("kma")) return "kma";
  if (s.startsWith("open_meteo")) return "open_meteo";
  if (s.startsWith("cli") || s === "manual") return "manual";
  if (s.startsWith("local")) return "local";
  return "unknown";
}

/** 브라우저로 내보낼 당일 예측 DTO (화이트리스트) */
function whitelistDailyRisk(raw) {
  if (!raw || typeof raw !== "object") return null;
  const metrics = raw.model_metrics || raw.metrics || {};
  const sample = raw.sample_weather || {};
  return {
    predict_date: raw.predict_date ?? null,
    weather_source: publicWeatherSource(raw.weather_source),
    sample_weather: {
      temp_avg: sample.temp_avg ?? null,
      temp_min: sample.temp_min ?? null,
      temp_max: sample.temp_max ?? null,
      precip: sample.precip ?? null,
      wind_avg: sample.wind_avg ?? null,
      wind_max: sample.wind_max ?? null,
      humidity_avg: sample.humidity_avg ?? null,
      humidity_min: sample.humidity_min ?? null,
    },
    n_regions: raw.n_regions ?? (Array.isArray(raw.regions) ? raw.regions.length : 0),
    note: "당일 시군구 산불 발생 예측 확률 (지도 색은 정규화 점수)",
    model_metrics:
      metrics.roc_auc != null || metrics.pr_auc != null
        ? {
            roc_auc: metrics.roc_auc ?? null,
            pr_auc: metrics.pr_auc ?? null,
          }
        : undefined,
    regions: Array.isArray(raw.regions)
      ? raw.regions.map((r) => ({
          code: String(r.code),
          name: r.name,
          province: r.province,
          ml_risk: r.ml_risk,
          ml_risk_norm: r.ml_risk_norm,
          humidity_min: r.humidity_min,
          temp_avg: r.temp_avg,
          precip: r.precip,
        }))
      : [],
  };
}

function whitelistMlScores(raw) {
  if (!raw || typeof raw !== "object") return null;
  const metrics = raw.metrics || raw.model_metrics || {};
  return {
    model: raw.model ?? "xgboost",
    test_start: raw.test_start,
    note: raw.note || "시군구 ML 위험 점수",
    metrics:
      metrics.roc_auc != null
        ? { roc_auc: metrics.roc_auc, pr_auc: metrics.pr_auc }
        : undefined,
    regions: Array.isArray(raw.regions)
      ? raw.regions.map((r) => ({
          code: String(r.code),
          name: r.name,
          province: r.province,
          ml_risk: r.ml_risk,
          ml_risk_norm: r.ml_risk_norm,
        }))
      : [],
  };
}

function whitelistMapData(raw) {
  if (!raw || typeof raw !== "object") return null;
  return {
    meta: {
      source: "wildfire-atlas",
      unit: raw.meta?.unit,
      color: raw.meta?.color,
      total_fires: raw.meta?.total_fires,
      total_mountains: raw.meta?.total_mountains,
      matched_fires: raw.meta?.matched_fires,
      regions: raw.meta?.regions,
      regions_with_fires: raw.meta?.regions_with_fires,
    },
    provinces: raw.provinces ?? [],
    regions: raw.regions ?? [],
    history: raw.history ?? {},
    mountains: raw.mountains ?? {},
  };
}

function whitelistAdmin(raw) {
  if (!raw || typeof raw !== "object") return null;
  return {
    level: raw.level,
    viewBox: raw.viewBox,
    regions: raw.regions,
    markers: raw.markers,
    meta: {
      n_regions: raw.meta?.n_regions,
      n_markers: raw.meta?.n_markers,
      max_fire_count: raw.meta?.max_fire_count,
      prob_note: raw.meta?.prob_note,
    },
  };
}

async function callFlaskPredict(body) {
  const r = await fetch(`${ML_SERVICE_URL}/predict/daily`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });
  const json = await r.json().catch(() => ({}));
  return { status: r.status, json };
}

async function runPredictDaily(body) {
  const source = body.source || "kma";
  const force = Boolean(body.force);
  const hasManual =
    typeof body.temp_avg === "number" ||
    (body.weather && typeof body.weather.temp_avg === "number");

  if (
    !force &&
    !hasManual &&
    source === "kma" &&
    predictCache &&
    Date.now() - predictCache.at < PREDICT_CACHE_MS
  ) {
    return { ok: true, data: predictCache.data, cached: true, status: 200 };
  }

  const { status, json } = await callFlaskPredict({
    source,
    force,
    date: body.date,
    weather: body.weather,
    temp_avg: body.temp_avg,
    temp_min: body.temp_min,
    temp_max: body.temp_max,
    precip: body.precip,
    wind_avg: body.wind_avg,
    wind_max: body.wind_max,
    humidity_avg: body.humidity_avg,
    humidity_min: body.humidity_min,
  });

  if (!json.ok || status >= 400) {
    console.error("[predict/daily] ml-service error", status, json?.error, json?.detail);
    return {
      ok: false,
      error: "예측에 실패했습니다. 잠시 후 다시 시도해 주세요.",
      status: 502,
    };
  }

  const data = whitelistDailyRisk(json.data);
  if (!hasManual && source === "kma") {
    predictCache = { at: Date.now(), data };
  }
  return { ok: true, data, cached: false, status: 200 };
}

app.get("/api/health", async (_req, res) => {
  let ml = null;
  try {
    const r = await fetch(`${ML_SERVICE_URL}/health`, {
      signal: AbortSignal.timeout(3000),
    });
    ml = await r.json();
  } catch {
    ml = { ok: false };
  }
  res.json({ ok: true, service: "express", ml_service: ml });
});

app.get("/api/map/data", async (_req, res) => {
  try {
    const raw = await readJson("map-data.json");
    res.json({ ok: true, data: whitelistMapData(raw) });
  } catch (e) {
    console.error("[map/data]", e);
    res.status(503).json({ ok: false, error: "지도 데이터를 불러올 수 없습니다." });
  }
});

app.get("/api/map/admin/:level", async (req, res) => {
  const fileMap = {
    sido: "admin-sido.json",
    sigungu: "admin-sigungu.json",
    emd: "admin-emd.json",
  };
  const file = fileMap[req.params.level];
  if (!file) {
    return res.status(400).json({ ok: false, error: "invalid level" });
  }
  try {
    const raw = await readJson(file);
    res.json({ ok: true, data: whitelistAdmin(raw) });
  } catch (e) {
    console.error("[map/admin]", e);
    res.status(503).json({ ok: false, error: "행정구역 데이터를 불러올 수 없습니다." });
  }
});

app.get("/api/map/ml-scores", async (_req, res) => {
  try {
    const raw = await readJson("sigungu_ml_scores.json");
    res.json({ ok: true, data: whitelistMlScores(raw) });
  } catch {
    res.json({ ok: true, data: null });
  }
});

app.get("/api/map/daily-risk", async (_req, res) => {
  try {
    const raw = await readJson("daily_ml_risk.json");
    res.json({ ok: true, data: whitelistDailyRisk(raw), cached: true });
  } catch {
    res.json({ ok: true, data: null });
  }
});

app.get("/api/mountains", async (req, res) => {
  const q = String(req.query.q || "")
    .trim()
    .toLowerCase();
  if (!q) {
    return res.json({ ok: true, data: [] });
  }
  try {
    const mapData = await readJson("map-data.json");
    const mountains = mapData.mountains || {};
    const hits = [];
    for (const [id, m] of Object.entries(mountains)) {
      const name = String(m.name || "").toLowerCase();
      const address = String(m.address || "").toLowerCase();
      if (name.includes(q) || address.includes(q)) {
        hits.push({
          id,
          name: m.name,
          height: m.height ?? null,
          address: m.address ?? "",
          fire_count: m.fire_count ?? 0,
          lon: m.lon ?? null,
          lat: m.lat ?? null,
          svg_x: m.svg_x ?? null,
          svg_y: m.svg_y ?? null,
        });
      }
      if (hits.length >= 40) break;
    }
    res.json({ ok: true, data: hits });
  } catch (e) {
    console.error("[mountains]", e);
    res.status(503).json({ ok: false, error: "산 검색에 실패했습니다." });
  }
});

app.post("/api/predict/daily", async (req, res) => {
  try {
    const result = await runPredictDaily(req.body || {});
    if (!result.ok) {
      return res.status(result.status || 502).json({
        ok: false,
        error: result.error,
      });
    }
    return res.json({ ok: true, data: result.data, cached: result.cached });
  } catch (e) {
    console.error("[predict/daily]", e);
    return res.status(502).json({
      ok: false,
      error: "예측 서버에 연결할 수 없습니다.",
    });
  }
});

/** 하위 호환: 예전 Next /api/predict */
app.post("/api/predict", async (req, res) => {
  try {
    const result = await runPredictDaily(req.body || {});
    if (!result.ok) {
      return res.status(result.status || 502).json({
        ok: false,
        error: result.error,
      });
    }
    return res.json({ ok: true, data: result.data, cached: result.cached });
  } catch (e) {
    console.error("[predict]", e);
    return res.status(502).json({
      ok: false,
      error: "예측 서버에 연결할 수 없습니다.",
    });
  }
});

app.get("/api/predict", async (req, res) => {
  const refresh = req.query.refresh === "1";
  if (!refresh && predictCache && Date.now() - predictCache.at < PREDICT_CACHE_MS) {
    return res.json({ ok: true, data: predictCache.data, cached: true });
  }
  if (!refresh) {
    try {
      const raw = await readJson("daily_ml_risk.json");
      return res.json({ ok: true, data: whitelistDailyRisk(raw), cached: false });
    } catch {
      /* fall through */
    }
  }
  try {
    const result = await runPredictDaily({ source: "kma", force: refresh });
    if (!result.ok) {
      return res.status(result.status || 502).json({
        ok: false,
        error: result.error,
      });
    }
    return res.json({ ok: true, data: result.data, cached: result.cached });
  } catch (e) {
    console.error("[predict GET]", e);
    return res.status(502).json({
      ok: false,
      error: "예측 서버에 연결할 수 없습니다.",
    });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`[server] http://localhost:${PORT}  (CORS: ${FRONTEND_ORIGIN})`);
  console.log(`[server] ml-service → ${ML_SERVICE_URL}`);
});
