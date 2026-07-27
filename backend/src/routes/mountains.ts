import { Router } from "express";
import { readJson } from "../lib/data.js";
import type { JsonObject, MountainHit } from "../types.js";

const router = Router();

function asObject(value: unknown): JsonObject | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as JsonObject;
}

router.get("/mountains", async (req, res) => {
  const q = String(req.query.q || "")
    .trim()
    .toLowerCase();
  if (!q) {
    return res.json({ ok: true, data: [] });
  }

  try {
    const mapData = await readJson("map-data.json");
    const mountains = asObject(mapData.mountains) ?? {};
    const hits: MountainHit[] = [];

    for (const [id, value] of Object.entries(mountains)) {
      const m = asObject(value) ?? {};
      const name = String(m.name || "").toLowerCase();
      const address = String(m.address || "").toLowerCase();
      if (name.includes(q) || address.includes(q)) {
        hits.push({
          id,
          name: m.name,
          height: m.height ?? null,
          address: String(m.address ?? ""),
          fire_count: Number(m.fire_count ?? 0),
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

export default router;
