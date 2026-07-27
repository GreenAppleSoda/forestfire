import { Router } from "express";
import { PREDICT_CACHE_MS } from "../config.js";
import { readJson } from "../lib/data.js";
import { callFlaskScenarioDefaults } from "../lib/mlClient.js";
import {
  getPredictCache,
  runPredictDaily,
  runPredictScenario,
} from "../lib/predictService.js";
import { whitelistDailyRisk } from "../lib/whitelist.js";
import type { PredictDailyBody, PredictScenarioBody } from "../types.js";

const router = Router();

router.post("/predict/daily", async (req, res) => {
  try {
    const result = await runPredictDaily(
      (req.body || {}) as PredictDailyBody,
    );
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

router.get("/predict/scenario/defaults", async (req, res) => {
  try {
    const { status, json } = await callFlaskScenarioDefaults(req.query);
    if (!json.ok || status >= 400) {
      return res
        .status(502)
        .json({ ok: false, error: "기본값을 불러오지 못했습니다." });
    }
    return res.json({ ok: true, data: json.data });
  } catch (e) {
    console.error("[predict/scenario/defaults]", e);
    return res.status(502).json({
      ok: false,
      error: "예측 서버에 연결할 수 없습니다.",
    });
  }
});

router.post("/predict/scenario", async (req, res) => {
  try {
    const result = await runPredictScenario(
      (req.body || {}) as PredictScenarioBody,
    );
    if (!result.ok) {
      return res.status(result.status || 502).json({
        ok: false,
        error: result.error,
      });
    }
    return res.json({ ok: true, data: result.data, cached: result.cached });
  } catch (e) {
    console.error("[predict/scenario]", e);
    return res.status(502).json({
      ok: false,
      error: "예측 서버에 연결할 수 없습니다.",
    });
  }
});

/** 하위 호환: 예전 Next /api/predict */
router.post("/predict", async (req, res) => {
  try {
    const result = await runPredictDaily(
      (req.body || {}) as PredictDailyBody,
    );
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

router.get("/predict", async (req, res) => {
  const refresh = req.query.refresh === "1";
  const cache = getPredictCache();
  if (!refresh && cache && Date.now() - cache.at < PREDICT_CACHE_MS) {
    return res.json({ ok: true, data: cache.data, cached: true });
  }
  if (!refresh) {
    try {
      const raw = await readJson("daily_ml_risk.json");
      return res.json({
        ok: true,
        data: whitelistDailyRisk(raw),
        cached: false,
      });
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

export default router;
