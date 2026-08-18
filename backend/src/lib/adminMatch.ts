/**
 * 행정구역 법정동명 매칭 — 접미사(시/군/구/읍/면/동/리)를 구분해 동명 충돌을 막는다.
 * etl/pipeline/admin_match.py 이식.
 */

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

const BLANK = new Set(["", "unknown", "nan", "none", "null"]);

export function compactName(name: string): string {
  return String(name || "")
    .trim()
    .replace(/\s+/g, "");
}

export function isBlank(name: unknown): boolean {
  const t = String(name ?? "").trim();
  return !t || BLANK.has(t.toLowerCase());
}

export function adminSuffix(name: string): string {
  const n = compactName(name);
  for (const sfx of ADMIN_SUFFIXES) {
    if (n.endsWith(sfx)) return sfx;
  }
  return "";
}

/** 비교용 어간. 접미사는 한 단계만 뗀다. */
export function stripAdmin(name: string): string {
  let n = compactName(name);
  n = n.replace(/(특별자치시|광역시|특별시|특별자치도)$/, "");
  n = n.replace(/(시|군|구|읍|면|동|리|가)$/, "");
  return n;
}

/** 같은 행정 단위인지. 장흥면 vs 장흥군처럼 접미사가 다르면 false. */
export function namesSameUnit(a: string, b: string): boolean {
  const ca = compactName(a);
  const cb = compactName(b);
  if (!ca || !cb || isBlank(ca) || isBlank(cb)) return false;
  if (ca === cb) return true;
  const sa = adminSuffix(ca);
  const sb = adminSuffix(cb);
  if (sa && sb && sa !== sb) return false;
  return stripAdmin(ca) === stripAdmin(cb);
}

export function isRedundantChild(parent: string, child: string): boolean {
  const p = compactName(parent);
  const c = compactName(child);
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
  while (out.length >= 2 && isRedundantChild(out[out.length - 2]!, out[out.length - 1]!)) {
    out.pop();
  }
  return out;
}

export function countCityFires(
  byCity: Record<string, number>,
  province: string,
  cityName: string,
): number {
  const key = `${province}|${stripAdmin(cityName)}`;
  const c = Number(byCity[key] || 0);
  if (c) return c;
  if (cityName.includes(" ")) {
    const last = cityName.split(" ").pop() || "";
    return Number(byCity[`${province}|${stripAdmin(last)}`] || 0);
  }
  return 0;
}

/** 시군구로 한정한 뒤, 읍·면·동 접미사까지 구분해 건수 집계. */
export function countTownFires(
  byTown: Record<string, number>,
  province: string,
  cityName: string,
  townName: string,
): number {
  if (!cityName || !townName) return 0;
  const prefix = `${province}|${stripAdmin(cityName)}|`;
  let exact = 0;
  let stemOnly = 0;
  const siblingStems = new Set<string>();
  for (const [k, cnt] of Object.entries(byTown)) {
    if (!k.startsWith(prefix)) continue;
    const town = k.slice(prefix.length);
    if (compactName(town) === compactName(townName)) {
      exact += Number(cnt);
      continue;
    }
    if (namesSameUnit(town, townName)) {
      if (adminSuffix(town)) exact += Number(cnt);
      else stemOnly += Number(cnt);
    }
    if (adminSuffix(town)) siblingStems.add(stripAdmin(town));
  }
  if (exact) return exact;
  const stem = stripAdmin(townName);
  if (stemOnly && [...siblingStems].every((s) => s === stem)) {
    return stemOnly;
  }
  return 0;
}
