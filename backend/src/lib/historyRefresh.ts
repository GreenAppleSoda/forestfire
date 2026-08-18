/**
 * MariaDB 산불 이력 → backend/data admin-*.json / map-data.json 건수·색 패치.
 * etl/map/refresh_history_layers.py + build_admin_layers 집계/색 이식.
 */
import { readJson, writeJson } from "./data.js";
import {
  countCityFires,
  countTownFires,
  stripAdmin,
} from "./adminMatch.js";
import { normalizeRegionPathString } from "./regionPath.js";
import type { JsonObject } from "../types.js";

export type FireRow = {
  date?: unknown;
  datetime?: unknown;
  province: string;
  city: string;
  town: string;
  village: string;
  damage_area: number;
  cause?: string;
  region_path: string;
};

const PROV_FULL: Record<string, string> = {
  서울: "서울특별시",
  부산: "부산광역시",
  대구: "대구광역시",
  인천: "인천광역시",
  광주: "광주광역시",
  대전: "대전광역시",
  울산: "울산광역시",
  세종: "세종특별자치시",
  경기: "경기도",
  강원: "강원특별자치도",
  충북: "충청북도",
  충남: "충청남도",
  전북: "전북특별자치도",
  전남: "전라남도",
  경북: "경상북도",
  경남: "경상남도",
  제주: "제주특별자치도",
};
const PROV_FULL_TO_SHORT: Record<string, string> = Object.fromEntries(
  Object.entries(PROV_FULL).map(([k, v]) => [v, k]),
);
const PROV_ALIAS_TO_SHORT: Record<string, string> = {
  전남광주통합특별시: "전남",
  전라북도: "전북",
  강원도: "강원",
};

const SIDO_SHORT_PAIRS: [string, string][] = [
  ["서울특별시", "서울"],
  ["부산광역시", "부산"],
  ["대구광역시", "대구"],
  ["인천광역시", "인천"],
  ["광주광역시", "광주"],
  ["대전광역시", "대전"],
  ["울산광역시", "울산"],
  ["세종특별자치시", "세종"],
  ["경기도", "경기"],
  ["강원특별자치도", "강원"],
  ["강원도", "강원"],
  ["충청북도", "충북"],
  ["충청남도", "충남"],
  ["전북특별자치도", "전북"],
  ["전라북도", "전북"],
  ["전라남도", "전남"],
  ["전남광주통합특별시", "전남"],
  ["경상북도", "경북"],
  ["경상남도", "경남"],
  ["제주특별자치도", "제주"],
];

const RISK_STOPS: [number, number, number, number][] = [
  [0.0, 142, 55, 38],
  [0.28, 98, 52, 46],
  [0.55, 55, 78, 50],
  [0.78, 36, 90, 50],
  [1.0, 24, 92, 48],
];

export function normalizeProvince(name: string): string {
  const raw = String(name || "").trim();
  if (!raw || raw === "Unknown") return "";
  if (raw in PROV_FULL) return raw;
  if (raw in PROV_FULL_TO_SHORT) return PROV_FULL_TO_SHORT[raw]!;
  if (raw in PROV_ALIAS_TO_SHORT) return PROV_ALIAS_TO_SHORT[raw]!;
  const compact = raw.replace(/\s+/g, "");
  if (compact in PROV_ALIAS_TO_SHORT) return PROV_ALIAS_TO_SHORT[compact]!;
  if (compact.includes("전남광주")) return "전남";
  const short = stripAdmin(raw);
  if (short in PROV_FULL) return short;
  for (const [k, full] of Object.entries(PROV_FULL)) {
    if (raw.startsWith(full) || raw.includes(full)) return k;
  }
  return "";
}

export function loadFires(rows: FireRow[]): FireRow[] {
  return rows
    .map((r) => ({
      ...r,
      province: normalizeProvince(String(r.province || "").trim()),
      city: String(r.city || "").trim(),
      town: String(r.town || "").trim(),
      village: String(r.village || "").trim(),
    }))
    .filter((r) => r.province);
}

export function buildFireIndexes(fires: FireRow[]): {
  byProv: Record<string, number>;
  byCity: Record<string, number>;
  byTownName: Record<string, number>;
} {
  const byProv: Record<string, number> = {};
  const byCity: Record<string, number> = {};
  const byTownName: Record<string, number> = {};
  for (const r of fires) {
    const p = r.province;
    const c = r.city;
    const t = r.town;
    byProv[p] = (byProv[p] || 0) + 1;
    const cityKey = `${p}|${stripAdmin(c)}`;
    byCity[cityKey] = (byCity[cityKey] || 0) + 1;
    if (t && t !== "Unknown") {
      const tk = `${p}|${stripAdmin(c)}|${t}`;
      byTownName[tk] = (byTownName[tk] || 0) + 1;
    }
  }
  return { byProv, byCity, byTownName };
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const sn = s / 100;
  const ln = l / 100;
  const c = (1 - Math.abs(2 * ln - 1)) * sn;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = ln - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255),
  ];
}

function hex(n: number): string {
  return n.toString(16).toUpperCase().padStart(2, "0");
}

function intensityFromCount(count: number, maxCount: number): number {
  if (maxCount <= 0 || count <= 0) return 0;
  return Math.round(Math.min(1, count / maxCount) * 10000) / 10000;
}

function intensityColor(intensity: number): string {
  const t = Math.max(0, Math.min(1, intensity));
  for (let i = 0; i < RISK_STOPS.length - 1; i++) {
    const [t0, h0, s0, l0] = RISK_STOPS[i]!;
    const [t1, h1, s1, l1] = RISK_STOPS[i + 1]!;
    if (t <= t1 || i === RISK_STOPS.length - 2) {
      const u = t1 === t0 ? 0 : (t - t0) / (t1 - t0);
      const h = h0 + (h1 - h0) * u;
      const s = s0 + (s1 - s0) * u;
      const l = l0 + (l1 - l0) * u;
      const [r, g, b] = hslToRgb(h, s, l);
      return `#${hex(r)}${hex(g)}${hex(b)}`;
    }
  }
  const last = RISK_STOPS[RISK_STOPS.length - 1]!;
  const [r, g, b] = hslToRgb(last[1], last[2], last[3]);
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

function applyIntensity(item: JsonObject, intensity: number): void {
  item.prob = intensity;
  item.color = intensityColor(intensity);
  item.r = Math.round((3.2 + 7.5 * intensity ** 0.85) * 100) / 100;
}

export function recolorRegionsByFireCount(regions: JsonObject[]): number {
  const mx = regions.reduce(
    (m, r) => Math.max(m, Number(r.fire_count || 0)),
    0,
  );
  for (const r of regions) {
    applyIntensity(r, intensityFromCount(Number(r.fire_count || 0), mx));
  }
  return mx;
}

/** map-data.json 전용 팔레트 (파랑→하늘→주황→빨강). */
export function lerpColor(tRaw: number): string {
  const t = Math.max(0, Math.min(1, tRaw));
  const stops: [number, [number, number, number]][] = [
    [0.0, [37, 99, 235]],
    [0.35, [56, 189, 248]],
    [0.7, [245, 158, 11]],
    [1.0, [220, 38, 38]],
  ];
  for (let i = 0; i < stops.length - 1; i++) {
    const [t0, c0] = stops[i]!;
    const [t1, c1] = stops[i + 1]!;
    if (t <= t1 || i === stops.length - 2) {
      let u = t1 === t0 ? 0 : (t - t0) / (t1 - t0);
      u = Math.max(0, Math.min(1, u));
      const r = Math.trunc(c0[0] + (c1[0] - c0[0]) * u);
      const g = Math.trunc(c0[1] + (c1[1] - c0[1]) * u);
      const b = Math.trunc(c0[2] + (c1[2] - c0[2]) * u);
      return `#${hex(r)}${hex(g)}${hex(b)}`;
    }
  }
  return "#DC2626";
}

function nowStamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function asRegions(data: JsonObject): JsonObject[] {
  return Array.isArray(data.regions) ? (data.regions as JsonObject[]) : [];
}

function sidoShort(prov: string, name: string): string {
  let short = prov;
  for (const [full, s] of SIDO_SHORT_PAIRS) {
    if (prov === full || name === full || prov.includes(full) || name.includes(full)) {
      short = s;
      break;
    }
  }
  return short;
}

async function patchAdminFile(
  filename: string,
  level: "sido" | "sigungu" | "emd",
  byProv: Record<string, number>,
  byCity: Record<string, number>,
  byTownName: Record<string, number>,
  sigNames: Record<string, string>,
): Promise<number> {
  let data: JsonObject;
  try {
    data = await readJson(filename);
  } catch {
    return 0;
  }
  const regions = asRegions(data);
  let n = 0;
  for (const item of regions) {
    const name = String(item.name || "");
    const prov = String(item.province || item.province_name || "");
    const code = String(item.code || "");
    const short = sidoShort(prov, name);
    let c = 0;
    if (level === "sido") {
      for (const [sk, cnt] of Object.entries(byProv)) {
        if (name.includes(sk) || name.startsWith(sk) || stripAdmin(name) === stripAdmin(sk)) {
          c += cnt;
        }
      }
      if ((name.includes("전남") && name.includes("광주")) || name === "전남광주통합특별시") {
        c = (byProv["전남"] || 0) + (byProv["광주"] || 0);
      } else if (!c) {
        c = byProv[short] || byProv[stripAdmin(name)] || 0;
      }
    } else if (level === "sigungu") {
      c = countCityFires(byCity, short, name);
    } else {
      const parent = code.length >= 5 ? sigNames[code.slice(0, 5)] || "" : "";
      c = countTownFires(byTownName, short, parent, name);
    }
    item.fire_count = Math.trunc(c);
    n += 1;
  }
  const mx = recolorRegionsByFireCount(regions);
  const meta = (data.meta as JsonObject) || {};
  meta.max_fire_count = mx;
  meta.prob_note = "과거 산불 발생 건수 상대 빈도(같은 행정 레벨 내 비교)";
  meta.synced_at = nowStamp();
  data.meta = meta;
  data.regions = regions;
  await writeJson(filename, data);
  return n;
}

function fmtDt(v: unknown): string {
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return v.toISOString();
  }
  return String(v ?? "");
}

function eventPayload(r: FireRow): JsonObject {
  return {
    datetime: fmtDt(r.datetime ?? r.date),
    region: normalizeRegionPathString(String(r.region_path || "")),
    city: String(r.city || ""),
    town: String(r.town || ""),
    village: String(r.village || ""),
    damage_area: Number(r.damage_area || 0),
    mountains: "",
    match_level: "db",
  };
}

async function refreshMapData(
  fires: FireRow[],
  totalFires: number,
): Promise<JsonObject> {
  let data: JsonObject;
  try {
    data = await readJson("map-data.json");
  } catch {
    return { updated: false, reason: "map-data.json missing" };
  }

  const byCityRows = new Map<string, FireRow[]>();
  for (const r of fires) {
    const p = String(r.province || "").trim();
    const c = String(r.city || "").trim();
    if (!p || !c || c === "Unknown") continue;
    const key = `${p}|${stripAdmin(c)}`;
    const list = byCityRows.get(key) || [];
    list.push(r);
    byCityRows.set(key, list);
  }

  const regions = Array.isArray(data.regions)
    ? (data.regions as JsonObject[])
    : Array.isArray(data.provinces)
      ? (data.provinces as JsonObject[])
      : [];
  const usedKeys = new Set<string>();
  const counts: number[] = [];
  for (const reg of regions) {
    const prov = String(reg.province || "").trim();
    const name = stripAdmin(String(reg.name || ""));
    const key = `${prov}|${name}`;
    usedKeys.add(key);
    counts.push((byCityRows.get(key) || []).length);
  }
  const maxCount = counts.length ? Math.max(...counts) : 1;

  const history: Record<string, JsonObject[]> = {};
  regions.forEach((reg, i) => {
    const fireCount = counts[i] || 0;
    const intensity = maxCount ? fireCount / maxCount : 0;
    reg.fire_count = fireCount;
    reg.intensity = Math.round(intensity * 10000) / 10000;
    reg.risk_score = Math.round(intensity * 1000) / 10;
    reg.color = fireCount > 0 ? lerpColor(intensity) : "#93C5FD";
    const code = String(reg.code || "");
    const prov = String(reg.province || "").trim();
    const name = stripAdmin(String(reg.name || ""));
    const rows = [...(byCityRows.get(`${prov}|${name}`) || [])].sort((a, b) =>
      fmtDt(b.datetime ?? b.date).localeCompare(fmtDt(a.datetime ?? a.date)),
    );
    if (code) history[code] = rows.map(eventPayload);
  });

  const leftover: FireRow[] = [];
  for (const [key, rows] of byCityRows) {
    if (!usedKeys.has(key)) leftover.push(...rows);
  }
  if (leftover.length) {
    leftover.sort((a, b) =>
      fmtDt(b.datetime ?? b.date).localeCompare(fmtDt(a.datetime ?? a.date)),
    );
    history._unmatched = leftover.map(eventPayload);
  }

  if (data.regions) data.regions = regions;
  data.provinces = [];
  data.history = history;
  const meta = (data.meta as JsonObject) || {};
  meta.total_fires = totalFires;
  meta.synced_at = nowStamp();
  meta.source = "mariadb:forestfire_stats";
  data.meta = meta;
  await writeJson("map-data.json", data);
  return {
    updated: true,
    regions: regions.length,
    total_fires: totalFires,
    history_keys: Object.keys(history).length,
    unmatched_city_events: leftover.length,
  };
}

export async function refreshHistoryLayers(raw: FireRow[]): Promise<JsonObject> {
  const totalFires = raw.length;
  const fires = loadFires(raw);
  const unmatched = totalFires - fires.length;
  const { byProv, byCity, byTownName } = buildFireIndexes(fires);

  const sigNames: Record<string, string> = {};
  try {
    const sig = await readJson("admin-sigungu.json");
    for (const item of asRegions(sig)) {
      const code = String(item.code || "");
      if (code) sigNames[code] = String(item.name || "");
    }
  } catch {
    /* optional */
  }

  const admin = {
    sido: await patchAdminFile(
      "admin-sido.json",
      "sido",
      byProv,
      byCity,
      byTownName,
      sigNames,
    ),
    sigungu: await patchAdminFile(
      "admin-sigungu.json",
      "sigungu",
      byProv,
      byCity,
      byTownName,
      sigNames,
    ),
    emd: await patchAdminFile(
      "admin-emd.json",
      "emd",
      byProv,
      byCity,
      byTownName,
      sigNames,
    ),
  };
  const mapInfo = await refreshMapData(fires, totalFires);
  return {
    ok: true,
    fire_rows: fires.length,
    fire_rows_raw: totalFires,
    unmatched_province: unmatched,
    admin,
    map_data: mapInfo,
    refreshed_at: nowStamp(),
  };
}
