import { Router } from "express";
import {
  callFlaskWildfireSync,
  callFlaskWildfireSyncStatus,
} from "../lib/mlClient.js";
import type { JsonObject } from "../types.js";

const router = Router();

router.get("/wildfires/sync/status", async (_req, res) => {
  try {
    const { ok, json } = await callFlaskWildfireSyncStatus();
    if (!ok || !json.ok) {
      return res.status(502).json({
        ok: false,
        error: "동기화 상태를 확인할 수 없습니다.",
      });
    }
    return res.json({ ok: true, data: json.data ?? null });
  } catch (e) {
    console.error("[wildfires/sync/status]", e);
    return res.status(502).json({
      ok: false,
      error: "동기화 서버에 연결할 수 없습니다.",
    });
  }
});

/** OpenAPI 산불 통계 증분 → 이력 맵 갱신 */
router.post("/wildfires/sync", async (req, res) => {
  try {
    const body = (req.body || {}) as JsonObject;
    const { ok, status, json } = await callFlaskWildfireSync({
      days: body.days,
      start: body.start,
      end: body.end,
    });
    if (!ok || !json.ok) {
      console.error("[wildfires/sync]", status, json.error, json.detail);
      const msg =
        json.error === "config_error"
          ? "산불 OpenAPI 키가 없습니다. ml-service/.env 의 FOREST_FIRE_SERVICE_KEY 를 확인하세요."
          : "산불 이력 동기화에 실패했습니다.";
      return res.status(502).json({ ok: false, error: msg });
    }
    return res.json({ ok: true, data: json.data });
  } catch (e) {
    console.error("[wildfires/sync]", e);
    return res.status(502).json({
      ok: false,
      error: "동기화 서버에 연결할 수 없습니다.",
    });
  }
});

export default router;
