import type { Response } from "express";
import { Router } from "express";
import { readJsonCached } from "../lib/data.js";
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

function setMapCacheHeaders(res: Response) {
  res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=600");
}

router.get("/map/data", async (_req, res) => {
  try {
    const raw = await readJsonCached("map-data.json");
    setMapCacheHeaders(res);
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
    const raw = await readJsonCached(file);
    setMapCacheHeaders(res);
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
    const raw = await readJsonCached("sigungu_ml_scores.json");
    setMapCacheHeaders(res);
    res.json({ ok: true, data: whitelistMlScores(raw) });
  } catch {
    res.json({ ok: true, data: null });
  }
});

router.get("/map/daily-risk", async (_req, res) => {
  try {
    const raw = await readJsonCached("daily_ml_risk.json");
    setMapCacheHeaders(res);
    res.json({ ok: true, data: whitelistDailyRisk(raw), cached: true });
  } catch {
    res.json({ ok: true, data: null });
  }
});

export default router;
