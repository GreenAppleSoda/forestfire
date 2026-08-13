import type { AdminLevel, AdminRegion } from "./types";

export type RegionHit = {
  region: AdminRegion;
  level: AdminLevel;
};

function compact(s: string) {
  return s
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
}

function coreName(name: string) {
  return compact(name)
    .replace(/(특별자치시|광역시|특별시|특별자치도)$/g, "")
    .replace(/(시|군|구)$/g, "");
}

const SIDO_ALIAS: Record<string, string> = {
  충남: "충청남",
  충북: "충청북",
  경남: "경상남",
  경북: "경상북",
  전남: "전라남",
  전북: "전라북",
};

/** 시도·시군구 이름 부분일치 검색 */
export function searchRegions(
  sido: AdminRegion[] | undefined,
  sigungu: AdminRegion[] | undefined,
  query: string,
  limit = 15,
): RegionHit[] {
  const q = compact(query);
  if (!q) return [];
  const qCore = coreName(query);
  const qAlias = SIDO_ALIAS[qCore] ?? qCore;

  const scored: Array<{ hit: RegionHit; score: number }> = [];

  const consider = (region: AdminRegion, level: AdminLevel) => {
    const name = compact(region.name);
    const core = coreName(region.name);
    const prov = compact(region.province || "");
    const provFull = compact(region.province_name || "");
    const combo = compact(`${region.province}${region.name}`);
    const comboFull = compact(`${region.province_name}${region.name}`);

    let score = -1;
    if (name === q || core === qCore || core === qAlias) score = 100;
    else if (
      name.startsWith(q) ||
      core.startsWith(qCore) ||
      core.startsWith(qAlias)
    )
      score = 80;
    else if (name.includes(q) || core.includes(qCore) || core.includes(qAlias))
      score = 60;
    else if (
      q.length > coreName(prov || provFull).length &&
      (combo === q ||
        comboFull === q ||
        combo.startsWith(q) ||
        comboFull.startsWith(q))
    )
      score = 70;

    if (score < 0) return;
    if (level === "sido") score += 8;
    scored.push({ hit: { region, level }, score });
  };

  for (const r of sido ?? []) consider(r, "sido");
  for (const r of sigungu ?? []) consider(r, "sigungu");

  scored.sort(
    (a, b) =>
      b.score - a.score ||
      a.hit.region.name.localeCompare(b.hit.region.name, "ko"),
  );
  return scored.slice(0, limit).map((x) => x.hit);
}

export function regionSearchSubtitle(hit: RegionHit): string {
  if (hit.level === "sido") {
    return hit.region.province_name || hit.region.name;
  }
  const parent = hit.region.province_name || hit.region.province || "";
  return parent ? `${parent} · 시군구` : "시군구";
}
