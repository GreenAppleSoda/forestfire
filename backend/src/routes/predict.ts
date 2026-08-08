import { Router } from "express";
import {
  runPredictDaily,
  runPredictScenario,
} from "../lib/predictService.js";
import type { PredictDailyBody, PredictScenarioBody } from "../types.js";

const router = Router();

router.post("/predict/daily", async (req, res) => {
  const started = Date.now();
  try {
    const body = (req.body || {}) as PredictDailyBody;
    console.log(
      "[predict/daily] start",
      `source=${body.source || "kma"}`,
      `force=${Boolean(body.force)}`,
    );
    const result = await runPredictDaily(body);
    if (!result.ok) {
      console.error(
        "[predict/daily] fail",
        `${Date.now() - started}ms`,
        result.error,
      );
      return res.status(result.status || 502).json({
        ok: false,
        error: result.error,
      });
    }
    console.log(
      "[predict/daily] ok",
      `${Date.now() - started}ms`,
      `cached=${Boolean(result.cached)}`,
      `n=${result.data?.n_regions ?? "?"}`,
    );
    return res.json({ ok: true, data: result.data, cached: result.cached });
  } catch (e) {
    console.error("[predict/daily]", `${Date.now() - started}ms`, e);
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
