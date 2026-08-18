/**
 * MariaDB forestfire_stats → backend/data 지도 JSON 이력 갱신.
 */
import fs from "node:fs/promises";
import path from "node:path";
import type { RowDataPacket } from "mysql2";
import { DATA_DIR } from "../config.js";
import { getPool, isDbConfigured } from "./db.js";
import { refreshHistoryLayers, type FireRow } from "./historyRefresh.js";
import { writeJson } from "./data.js";
import type { JsonObject } from "../types.js";

const SYNC_STATE_FILE = "wildfire_sync_state.json";

export type SyncInfo = {
  last_sync_at?: string;
  source?: string;
  fetched?: number;
  added?: number;
  refined_total?: number;
};

export async function readSyncStatus(): Promise<SyncInfo | null> {
  try {
    const full = path.join(DATA_DIR, SYNC_STATE_FILE);
    const text = await fs.readFile(full, "utf-8");
    const data = JSON.parse(text) as SyncInfo;
    return {
      last_sync_at: data.last_sync_at,
      source: data.source,
      fetched: data.fetched,
      added: data.added,
      refined_total: data.refined_total,
    };
  } catch {
    return null;
  }
}

async function fetchForestfireStats(): Promise<FireRow[]> {
  const pool = getPool();
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT
       \`date\`,
       \`datetime\`,
       province,
       city,
       town,
       village,
       damage_area,
       cause,
       region_path,
       is_fire
     FROM forestfire_stats
     ORDER BY \`datetime\` DESC`,
  );
  if (!rows.length) {
    throw new Error("forestfire_stats 조회 결과가 비어 있습니다.");
  }
  return rows.map((r) => ({
    date: r.date,
    datetime: r.datetime,
    province: String(r.province ?? "").trim(),
    city: String(r.city ?? "").trim(),
    town: String(r.town ?? "").trim(),
    village: String(r.village ?? "").trim(),
    damage_area: Number(r.damage_area ?? 0) || 0,
    cause: String(r.cause ?? "").trim(),
    region_path: String(r.region_path ?? "").trim(),
  }));
}

export async function runWildfireSync(): Promise<JsonObject> {
  if (!isDbConfigured()) {
    const err = new Error(
      "MariaDB 접속 정보가 없습니다. backend/.env 의 DB_* 를 확인하세요.",
    );
    (err as Error & { code?: string }).code = "config_error";
    throw err;
  }

  const fires = await fetchForestfireStats();
  const mapRefresh = await refreshHistoryLayers(fires);
  const lastSyncAt = String(mapRefresh.refreshed_at || "");
  const state = {
    last_sync_at: lastSyncAt,
    source: "mariadb:forestfire_stats",
    fetched: fires.length,
    added: 0,
    refined_total: fires.length,
    map_refresh: mapRefresh,
  };
  await writeJson(SYNC_STATE_FILE, state);
  return {
    last_sync_at: state.last_sync_at,
    source: state.source,
    fetched: state.fetched,
    added: state.added,
    refined_total: state.refined_total,
    map_refreshed: Boolean(mapRefresh.map_data),
  };
}
