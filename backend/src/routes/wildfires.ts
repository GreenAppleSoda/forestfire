import { Router } from "express";
import { readSyncStatus, runWildfireSync } from "../lib/wildfireSync.js";

const router = Router();

router.get("/wildfires/sync/status", async (_req, res) => {
  try {
    const data = await readSyncStatus();
    return res.json({ ok: true, data });
  } catch (e) {
    console.error("[wildfires/sync/status]", e);
    return res.status(502).json({
      ok: false,
      error: "동기화 상태를 확인할 수 없습니다.",
    });
  }
});

/** MariaDB 산불이력 → backend/data 이력 맵 갱신 */
router.post("/wildfires/sync", async (_req, res) => {
  try {
    const data = await runWildfireSync();
    return res.json({ ok: true, data });
  } catch (e) {
    console.error("[wildfires/sync]", e);
    const code = (e as Error & { code?: string }).code;
    const detail = e instanceof Error ? e.message.trim() : "";
    const msg =
      code === "config_error"
        ? detail
        : detail
          ? `산불 이력 동기화 실패: ${detail}`
          : "산불 이력 동기화에 실패했습니다.";
    const status = code === "config_error" ? 503 : 502;
    return res.status(status).json({ ok: false, error: msg });
  }
});

export default router;
