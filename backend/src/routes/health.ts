import { Router } from "express";
import { callFlaskHealth } from "../lib/mlClient.js";
import type { FlaskJson } from "../types.js";

const router = Router();

router.get("/health", async (_req, res) => {
  let ml: FlaskJson | { ok: false } = { ok: false };
  try {
    ml = await callFlaskHealth();
  } catch {
    ml = { ok: false };
  }
  res.json({ ok: true, service: "express", ml_service: ml });
});

export default router;
