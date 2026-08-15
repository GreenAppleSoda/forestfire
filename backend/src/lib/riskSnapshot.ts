/**
 * 당일 산불 위험 스냅샷 — 예측 API 우선, 실패 시 backend/data 파일 폴백.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { DATA_DIR } from "../config.js";
import { runPredictDaily } from "./predictService.js";
import { whitelistDailyRisk } from "./whitelist.js";
import type { DailyRiskDto, DailyRiskRegion } from "../types.js";

const DAILY_ML_RISK_FILE = path.join(DATA_DIR, "daily_ml_risk.json");

export type RiskSnapshotSource = "live" | "file";

export type RiskSnapshot = {
  source: RiskSnapshotSource;
  data: DailyRiskDto;
};

export async function loadDailyMlRiskFromFile(): Promise<DailyRiskDto | null> {
  try {
    const text = await fs.readFile(DAILY_ML_RISK_FILE, "utf-8");
    return whitelistDailyRisk(JSON.parse(text));
  } catch {
    return null;
  }
}

/** 기상/예측 API 성공 시 live, 아니면 파일. 둘 다 없으면 null */
export async function resolveRiskSnapshot(): Promise<RiskSnapshot | null> {
  try {
    const result = await runPredictDaily({ source: "kma" });
    if (result.ok && result.data) {
      return { source: "live", data: result.data };
    }
  } catch (e) {
    console.error("[riskSnapshot] live predict failed", e);
  }

  const fileData = await loadDailyMlRiskFromFile();
  if (fileData) {
    return { source: "file", data: fileData };
  }
  return null;
}

export function riskIndex(mlRisk: unknown): number | null {
  const n = Number(mlRisk);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 1000) / 10; // 소수 1자리 (×100)
}

export function sortRegionsByRisk(
  regions: DailyRiskRegion[],
  dir: "desc" | "asc" = "desc",
): DailyRiskRegion[] {
  return [...regions].sort((a, b) => {
    const da = Number(a.ml_risk) || 0;
    const db = Number(b.ml_risk) || 0;
    return dir === "desc" ? db - da : da - db;
  });
}

/** Gemini 프롬프트용 — 전체 regions 포함 (광역 평균 계산용) */
export function snapshotToPromptJson(snap: RiskSnapshot): string {
  return JSON.stringify(
    {
      data_source: snap.source === "live" ? "realtime_predict_api" : "cached_file_fallback",
      ...snap.data,
    },
    null,
    0,
  );
}
