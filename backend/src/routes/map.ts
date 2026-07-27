import { Router } from "express";
import { readJson } from "../lib/data.js";
import {
  whitelistAdmin,
  whitelistDailyRisk,
  whitelistMapData,
  whitelistMlScores,
} from "../lib/whitelist.js";

const router = Router();

const ADMIN_FILES: Record<string, string> = {
  sido: "admin-sido.json",
  sigungu: "admin-sigungu.json",
  emd: "admin-emd.json",
};

router.get("/map/data", async (_req, res) => {
  try {
    const raw = await readJson("map-data.json");
    res.json({ ok: true, data: whitelistMapData(raw) });
  } catch (e) {
    console.error("[map/data]", e);
    res.status(503).json({ ok: false, error: "지도 데이터를 불러올 수 없습니다." });
  }
});

router.get("/map/admin/:level", async (req, res) => {
  const file = ADMIN_FILES[req.params.level ?? ""];
  if (!file) {
    return res.status(400).json({ ok: false, error: "invalid level" });
  }
  try {
    const raw = await readJson(file);
    res.json({ ok: true, data: whitelistAdmin(raw) });
  } catch (e) {
    console.error("[map/admin]", e);
    res
      .status(503)
      .json({ ok: false, error: "행정구역 데이터를 불러올 수 없습니다." });
  }
});

router.get("/map/ml-scores", async (_req, res) => {
  try {
    const raw = await readJson("sigungu_ml_scores.json");
    res.json({ ok: true, data: whitelistMlScores(raw) });
  } catch {
    res.json({ ok: true, data: null });
  }
});

router.get("/map/daily-risk", async (_req, res) => {
  try {
    const raw = await readJson("daily_ml_risk.json");
    res.json({ ok: true, data: whitelistDailyRisk(raw), cached: true });
  } catch {
    res.json({ ok: true, data: null });
  }
});

export default router;
