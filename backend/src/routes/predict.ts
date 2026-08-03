import { Router } from "express";
import {
  runPredictDaily,
  runPredictScenario,
} from "../lib/predictService.js";
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

export default router;
