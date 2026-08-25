/** 행정구역 법정동명 매칭 — 접미사(시/군/구/읍/면/동)로 동명을 분별한다. */

import type { AdminLevel, AdminRegion } from "./types";

const ADMIN_SUFFIXES = [
  "특별자치시",
  "광역시",
  "특별시",
  "특별자치도",
  "자치도",
  "읍",
  "면",
  "동",
  "리",
  "가",
  "시",
  "군",
  "구",
] as const;

const PROV_SHORT: Record<string, string> = {
  서울특별시: "서울",
  부산광역시: "부산",
  대구광역시: "대구",
  인천광역시: "인천",
  광주광역시: "광주",
  대전광역시: "대전",
  울산광역시: "울산",
  세종특별자치시: "세종",
  경기도: "경기",
  강원특별자치도: "강원",
  강원도: "강원",
  충청북도: "충북",
  충청남도: "충남",
  전북특별자치도: "전북",
  전라북도: "전북",
  전라남도: "전남",
  전남광주통합특별시: "전남",
  경상북도: "경북",
  경상남도: "경남",
  제주특별자치도: "제주",
};

function compact(name: string): string {
  return name.replace(/\s+/g, "").trim();
}

function isBlank(name: string | null | undefined): boolean {
  const t = (name || "").trim();
  return !t || t.toLowerCase() === "unknown";
}

export function adminSuffix(name: string): string {
  const n = compact(name);
  for (const sfx of ADMIN_SUFFIXES) {
    if (n.endsWith(sfx)) return sfx;
  }
  return "";
}

export function stripAdmin(name: string): string {
  return compact(name)
    .replace(/(특별자치시|광역시|특별시|특별자치도)$/g, "")
    .replace(/(시|군|구|읍|면|동|리|가)$/g, "");
}

export function provinceKey(name: string): string {
  const raw = compact(name);
  if (!raw) return "";
  if (PROV_SHORT[raw]) return PROV_SHORT[raw];
  const stripped = raw
    .replace(/(특별자치시|광역시|특별시|특별자치도)$/g, "")
    .replace(/(도)$/g, "");
  if (PROV_SHORT[stripped]) return PROV_SHORT[stripped];
  for (const [full, short] of Object.entries(PROV_SHORT)) {
    if (raw === short || raw.startsWith(full) || full.startsWith(raw)) return short;
  }
  return stripped || raw;
}

export function namesSameUnit(a: string, b: string): boolean {
  const ca = compact(a);
  const cb = compact(b);
  if (!ca || !cb || isBlank(ca) || isBlank(cb)) return false;
  if (ca === cb) return true;
  const sa = adminSuffix(ca);
  const sb = adminSuffix(cb);
  if (sa && sb && sa !== sb) return false;
  return stripAdmin(ca) === stripAdmin(cb);
}

export function isRedundantChild(parent: string, child: string): boolean {
  const p = compact(parent);
  const c = compact(child);
  if (!p || !c || isBlank(p) || isBlank(c)) return false;
  if (p === c) return true;
  const childSfx = adminSuffix(c);
  if (childSfx === "리" || childSfx === "가") return false;
  if (stripAdmin(p) === c) return true;
  if (!childSfx && stripAdmin(p) === stripAdmin(c)) return true;
  return false;
}

export function collapseRedundantParts(parts: string[]): string[] {
  const out = parts.filter((p) => !isBlank(p));
  while (out.length >= 2 && isRedundantChild(out[out.length - 2], out[out.length - 1])) {
    out.pop();
  }
  return out;
}

export type FireEventLike = {
  region?: string;
  city?: string;
  town?: string;
  village?: string;
};

function regionParts(region: string): string[] {
  return region.split(/\s*>\s*/).map((s) => s.trim()).filter((s) => !isBlank(s));
}

function provinceMatchesEvent(ev: FireEventLike, province: string): boolean {
  const want = provinceKey(province);
  if (!want) return false;
  const parts = regionParts(ev.region || "");
  if (parts[0] && provinceKey(parts[0]) === want) return true;
  return false;
}

function cityMatchesEvent(ev: FireEventLike, cityName: string): boolean {
  if (namesSameUnit(ev.city || "", cityName)) return true;
  const parts = regionParts(ev.region || "");
  return parts.length >= 2 && namesSameUnit(parts[1], cityName);
}

function townMatchesEvent(ev: FireEventLike, townName: string): boolean {
  if (namesSameUnit(ev.town || "", townName)) return true;
  const parts = regionParts(ev.region || "");
  return parts.length >= 3 && namesSameUnit(parts[2], townName);
}

/** 선택된 행정구역(시도/시군구/읍면동)에 속한 산불만 true */
export function eventMatchesSelection(
  ev: FireEventLike,
  opts: {
    level: AdminLevel;
    province: string;
    name: string;
    parentName?: string | null;
  },
): boolean {
  if (!opts.province || !opts.name) return false;

  const mergedHonam =
    opts.level === "sido" &&
    opts.name.includes("전남") &&
    opts.name.includes("광주");
  if (mergedHonam) {
    return (
      provinceMatchesEvent(ev, "전남") || provinceMatchesEvent(ev, "광주")
    );
  }

  if (!provinceMatchesEvent(ev, opts.province)) return false;

  if (opts.level === "sido") return true;

  if (opts.level === "sigungu") {
    return cityMatchesEvent(ev, opts.name);
  }

  const parent = opts.parentName || "";
  if (parent && !cityMatchesEvent(ev, parent)) return false;
  if (!parent) return false;
  return townMatchesEvent(ev, opts.name);
}

/** 산불 이력 → 가장 구체적인 행정구역 (읍면동 > 시군구 > 시도) */
export function findAdminForFireEvent(
  ev: FireEventLike,
  opts: {
    emd: AdminRegion[];
    sigungu: AdminRegion[];
    sido: AdminRegion[];
    sigunguByCode: Map<string, AdminRegion>;
  },
): { region: AdminRegion; level: AdminLevel } | null {
  for (const r of opts.emd) {
    const parent =
      r.code.length >= 5 ? opts.sigunguByCode.get(r.code.slice(0, 5)) : undefined;
    if (
      eventMatchesSelection(ev, {
        level: "emd",
        province: r.province_name || r.province,
        name: r.name,
        parentName: parent?.name ?? null,
      })
    ) {
      return { region: r, level: "emd" };
    }
  }
  for (const r of opts.sigungu) {
    if (
      eventMatchesSelection(ev, {
        level: "sigungu",
        province: r.province_name || r.province,
        name: r.name,
      })
    ) {
      return { region: r, level: "sigungu" };
    }
  }
  for (const r of opts.sido) {
    if (
      eventMatchesSelection(ev, {
        level: "sido",
        province: r.province_name || r.province || r.name,
        name: r.name,
      })
    ) {
      return { region: r, level: "sido" };
    }
  }
  return null;
}
