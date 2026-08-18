/**
 * 법정동 lookup 으로 산불 지역명(약칭)을 공식명으로 정규화.
 * etl/pipeline/normalize_region_names.py 이식.
 */
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR, ROOT } from "../config.js";
import { collapseRedundantParts } from "./adminMatch.js";

type Lookup = {
  sido?: Record<string, string>;
  sigungu?: Record<string, string>;
  emd?: Record<string, string>;
  li?: Record<string, string>;
};

const LOOKUP_CANDIDATES = [
  path.join(DATA_DIR, "legal-dong-lookup.json"),
  path.join(ROOT, "frontend", "public", "data", "legal-dong-lookup.json"),
  path.join(ROOT, "db-archive", "processed", "legal_dong_lookup.json"),
];

let lookupCache: Lookup | null | undefined;

function stripKey(name: string): string {
  let s = String(name).trim().replace(/\s+/g, "");
  s = s.replace(/(특별자치시|광역시|특별시|특별자치도|자치도)$/, "");
  s = s.replace(/(시|군|구|읍|면|동|리|가)$/, "");
  return s;
}

function isBlank(s: string): boolean {
  const t = String(s || "").trim();
  return !t || t.toLowerCase() === "unknown" || t === "nan" || t === "None";
}

function loadLookup(): Lookup | null {
  if (lookupCache !== undefined) return lookupCache;
  for (const p of LOOKUP_CANDIDATES) {
    try {
      if (fs.existsSync(p)) {
        lookupCache = JSON.parse(fs.readFileSync(p, "utf-8")) as Lookup;
        return lookupCache;
      }
    } catch {
      /* next */
    }
  }
  lookupCache = null;
  return null;
}

function resolveSido(lookup: Lookup, raw: string): string {
  const sido = lookup.sido || {};
  if (raw in sido) return sido[raw]!;
  const sk = stripKey(raw);
  if (sk in sido) return sido[sk]!;
  return raw;
}

function resolveChild(
  table: Record<string, string>,
  parent: string,
  raw: string,
): string {
  if (!raw) return raw;
  for (const key of [`${parent}|${raw}`, `${parent}|${stripKey(raw)}`]) {
    if (key in table) return table[key]!;
  }
  return raw;
}

export function normalizeParts(
  province = "",
  city = "",
  town = "",
  village = "",
  lookup?: Lookup | null,
): string[] {
  const table = lookup === undefined ? loadLookup() : lookup;
  const cleaned = [province, city, town, village]
    .map((p) => String(p || "").trim())
    .filter((p) => !isBlank(p));
  if (!cleaned.length) return [];
  if (!table) return collapseRedundantParts(cleaned);

  const sigMap = table.sigungu || {};
  const emdMap = table.emd || {};
  const liMap = table.li || {};

  const out: string[] = [];
  const sido = resolveSido(table, cleaned[0]!);
  out.push(sido);

  if (cleaned.length < 2) return collapseRedundantParts(out);
  let sig = resolveChild(sigMap, sido, cleaned[1]!);
  if (sig === cleaned[1]) {
    for (const alt of new Set([sido, cleaned[0]!, stripKey(sido)])) {
      const hit = resolveChild(sigMap, alt, cleaned[1]!);
      if (hit !== cleaned[1]) {
        sig = hit;
        break;
      }
    }
  }
  out.push(sig);

  if (cleaned.length < 3) return collapseRedundantParts(out);
  let emd = resolveChild(emdMap, `${sido}|${sig}`, cleaned[2]!);
  if (emd === cleaned[2]) {
    for (const sigAlt of new Set([sig, stripKey(sig), cleaned[1]!])) {
      const hit = resolveChild(emdMap, `${sido}|${sigAlt}`, cleaned[2]!);
      if (hit !== cleaned[2]) {
        emd = hit;
        break;
      }
    }
  }
  out.push(emd);

  if (cleaned.length < 4) return collapseRedundantParts(out);
  let li = resolveChild(liMap, `${sido}|${sig}|${emd}`, cleaned[3]!);
  if (li === cleaned[3]) {
    for (const emdAlt of new Set([emd, stripKey(emd), cleaned[2]!])) {
      const hit = resolveChild(liMap, `${sido}|${sig}|${emdAlt}`, cleaned[3]!);
      if (hit !== cleaned[3]) {
        li = hit;
        break;
      }
    }
  }
  out.push(li);
  return collapseRedundantParts(out);
}

export function formatRegionPath(...parts: unknown[]): string {
  let vals = parts.map((p) => String(p ?? "").trim());
  if (vals.length === 1 && vals[0]!.includes(">")) {
    vals = vals[0]!.split(">").map((p) => p.trim());
  }
  while (vals.length < 4) vals.push("");
  return normalizeParts(vals[0], vals[1], vals[2], vals[3]).join(" > ");
}

export function normalizeRegionPathString(regionPath: string): string {
  return formatRegionPath(regionPath);
}
