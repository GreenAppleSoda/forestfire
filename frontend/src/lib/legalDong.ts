/** 법정동 lookup 으로 산불 region_path 약칭 → 공식명 */

import { collapseRedundantParts } from "./adminMatch";

export type LegalDongLookup = {
  sido: Record<string, string>;
  sigungu: Record<string, string>;
  emd: Record<string, string>;
  li: Record<string, string>;
};

function stripKey(name: string): string {
  return name
    .replace(/\s+/g, "")
    .replace(/(특별자치시|광역시|특별시|특별자치도|자치도)$/, "")
    .replace(/(시|군|구|읍|면|동|리|가)$/, "");
}

function isBlank(s: string): boolean {
  const t = s.trim();
  return !t || t.toLowerCase() === "unknown";
}

function resolveSido(lookup: LegalDongLookup, raw: string): string {
  return lookup.sido[raw] ?? lookup.sido[stripKey(raw)] ?? raw;
}

function resolveChild(
  table: Record<string, string>,
  parent: string,
  raw: string,
): string {
  return (
    table[`${parent}|${raw}`] ??
    table[`${parent}|${stripKey(raw)}`] ??
    raw
  );
}

export function normalizeRegionParts(
  parts: string[],
  lookup: LegalDongLookup | null | undefined,
): string[] {
  const cleaned = parts.map((p) => p.trim()).filter((p) => !isBlank(p));
  if (!cleaned.length) return [];
  if (!lookup) return cleaned;

  const out: string[] = [];
  const sido = resolveSido(lookup, cleaned[0]);
  out.push(sido);
  if (cleaned.length < 2) return out;

  let sig = resolveChild(lookup.sigungu, sido, cleaned[1]);
  if (sig === cleaned[1]) {
    for (const alt of new Set([sido, cleaned[0], stripKey(sido)])) {
      const hit = resolveChild(lookup.sigungu, alt, cleaned[1]);
      if (hit !== cleaned[1]) {
        sig = hit;
        break;
      }
    }
  }
  out.push(sig);
  if (cleaned.length < 3) return out;

  let emd = resolveChild(lookup.emd, `${sido}|${sig}`, cleaned[2]);
  if (emd === cleaned[2]) {
    for (const sigAlt of new Set([sig, stripKey(sig), cleaned[1]])) {
      const hit = resolveChild(lookup.emd, `${sido}|${sigAlt}`, cleaned[2]);
      if (hit !== cleaned[2]) {
        emd = hit;
        break;
      }
    }
  }
  out.push(emd);
  if (cleaned.length < 4) return out;

  let li = resolveChild(lookup.li, `${sido}|${sig}|${emd}`, cleaned[3]);
  if (li === cleaned[3]) {
    for (const emdAlt of new Set([emd, stripKey(emd), cleaned[2]])) {
      const hit = resolveChild(
        lookup.li,
        `${sido}|${sig}|${emdAlt}`,
        cleaned[3],
      );
      if (hit !== cleaned[3]) {
        li = hit;
        break;
      }
    }
  }
  out.push(li);
  return out;
}

/** Unknown 제거 + 법정동 공식명 */
export function formatRegionPath(
  region: string,
  lookup?: LegalDongLookup | null,
): string {
  const parts = region.split(/\s*>\s*/).map((s) => s.trim());
  return collapseRedundantParts(normalizeRegionParts(parts, lookup)).join(" > ");
}
