/**
 * 보고서 API
 * GET  /api/report/daily — JSON 요약 (회원)
 * POST /api/report/pdf   — 슬라이드형 PDF 생성 (회원) body: { regionQuery?: string }
 * GET  /api/report/download/:id — 임시 PDF 다운로드
 */
import { randomUUID } from "node:crypto";
import { Router } from "express";
import { resolveRegionFocus } from "../lib/regionFocus.js";
import { buildRegionReportPdf } from "../lib/reportService.js";
import { getReportPdf, putReportPdf } from "../lib/reportStore.js";
import {
  resolveRiskSnapshot,
  riskIndex,
  sortRegionsByRisk,
} from "../lib/riskSnapshot.js";
import { requireAuth } from "../middleware/optionalAuth.js";

const router = Router();

router.get("/report/daily", requireAuth, async (req, res) => {
  try {
    const regionQuery = String(req.query.region || req.query.q || "").trim();
    const snap = await resolveRiskSnapshot();
    if (!snap) {
      return res.status(503).json({
        ok: false,
        error: "예측 데이터를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.",
      });
    }

    const focus = resolveRegionFocus(regionQuery);
    const { data, source } = snap;
    const regions = data.regions || [];
    const indices = regions
      .map((r) => riskIndex(r.ml_risk))
      .filter((n): n is number => n != null);
    const avg =
      indices.length > 0
        ? Math.round((indices.reduce((a, b) => a + b, 0) / indices.length) * 10) / 10
        : null;

    const byHigh = sortRegionsByRisk(regions, "desc");
    const byLow = sortRegionsByRisk(regions, "asc");
    const mapRow = (r: (typeof regions)[number]) => ({
      name: String(r.name ?? ""),
      province: String(r.province ?? ""),
      riskIndex: riskIndex(r.ml_risk),
    });

    const user = req.user!;
    return res.json({
      ok: true,
      source,
      focus: focus.label,
      report: {
        title: "산불맵 당일 위험 요약 보고서",
        generatedAt: new Date().toISOString(),
        member: {
          name: user.name,
          nickname: user.nickname,
          loginId: user.loginId,
          email: user.email,
        },
        predictDate: data.predict_date ?? null,
        observedAt: data.observed_at ?? null,
        weatherSource: data.weather_source,
        sampleWeather: data.sample_weather,
        note: data.note,
        summary: {
          regionCount: data.n_regions || regions.length,
          averageRiskIndex: avg,
          highest: byHigh[0] ? mapRow(byHigh[0]) : null,
          lowest: byLow[0] ? mapRow(byLow[0]) : null,
        },
        topHigh: byHigh.slice(0, 10).map(mapRow),
        topLow: byLow.slice(0, 5).map(mapRow),
        sourceLabel:
          source === "live"
            ? "실시간 예측 API (또는 서버 캐시)"
            : "캐시 파일 (기상/예측 API 실패 시 대체)",
      },
    });
  } catch (e) {
    console.error("[report/daily]", e);
    return res.status(502).json({
      ok: false,
      error: "보고서 생성에 실패했습니다.",
    });
  }
});

router.post("/report/pdf", requireAuth, async (req, res) => {
  try {
    const regionQuery = String(req.body?.regionQuery || req.body?.region || "").trim();
    const focus = resolveRegionFocus(regionQuery);

    const built = await buildRegionReportPdf(focus.label);
    if (!built.ok) {
      return res.status(built.status).json({ ok: false, error: built.error });
    }

    const id = randomUUID();
    putReportPdf(id, built.buffer, built.filename);

    return res.json({
      ok: true,
      id,
      filename: built.filename,
      focusLabel: built.regionLabel || focus.label,
      downloadPath: `/api/report/download/${id}`,
    });
  } catch (e) {
    console.error("[report/pdf]", e);
    const msg = e instanceof Error ? e.message : "PDF 생성에 실패했습니다.";
    return res.status(502).json({ ok: false, error: msg });
  }
});

router.get("/report/download/:id", requireAuth, (req, res) => {
  const id = String(req.params.id || "");
  const entry = getReportPdf(id);
  if (!entry) {
    return res.status(404).json({
      ok: false,
      error: "다운로드 파일이 없거나 만료되었습니다. 보고서를 다시 생성해 주세요.",
    });
  }
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename*=UTF-8''${encodeURIComponent(entry.filename)}`,
  );
  return res.send(entry.buffer);
});

export default router;
