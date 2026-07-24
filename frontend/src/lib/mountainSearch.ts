import type { MountainInfo, RegionStat, AdminRegion } from "@/lib/types";

export function normalizeMountainQuery(q: string) {
  return q
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/_/g, "");
}

export function mountainSearchKey(name: string) {
  return normalizeMountainQuery(name).replace(/(산)$/g, "");
}

/** 산 이름 부분일치 검색 */
export function searchMountains(
  index: Record<string, MountainInfo> | undefined,
  query: string,
  limit = 20,
): MountainInfo[] {
  if (!index || !query.trim()) return [];
  const q = normalizeMountainQuery(query);
  const qCore = mountainSearchKey(query);
  const scored: Array<{ m: MountainInfo; score: number }> = [];

  for (const m of Object.values(index)) {
    const name = normalizeMountainQuery(m.name);
    const core = mountainSearchKey(m.name);
    let score = -1;
    if (name === q || core === qCore) score = 100;
    else if (name.startsWith(q) || core.startsWith(qCore)) score = 80;
    else if (name.includes(q) || core.includes(qCore)) score = 60;
    else if (m.address && normalizeMountainQuery(m.address).includes(q))
      score = 40;
    if (score >= 0) scored.push({ m, score });
  }

  scored.sort(
    (a, b) =>
      b.score - a.score ||
      (b.m.fire_count ?? 0) - (a.m.fire_count ?? 0) ||
      a.m.name.localeCompare(b.m.name, "ko"),
  );
  return scored.slice(0, limit).map((x) => x.m);
}

function stripAdmin(name: string) {
  return name
    .replace(/\s+/g, "")
    .replace(/(특별자치시|광역시|특별시|특별자치도)$/g, "")
    .replace(/(시|군|구)$/g, "");
}

const PROV_FROM_ADDR: Array<[RegExp, string]> = [
  [/서울/, "서울"],
  [/부산/, "부산"],
  [/대구/, "대구"],
  [/인천/, "인천"],
  [/광주/, "광주"],
  [/대전/, "대전"],
  [/울산/, "울산"],
  [/세종/, "세종"],
  [/경기/, "경기"],
  [/강원/, "강원"],
  [/충북|충청북/, "충북"],
  [/충남|충청남/, "충남"],
  [/전북|전라북/, "전북"],
  [/전남|전라남/, "전남"],
  [/경북|경상북/, "경북"],
  [/경남|경상남/, "경남"],
  [/제주/, "제주"],
];

/** 주소 문자열에서 시도·시군구 힌트 추출 */
export function parseAddressHint(address: string): {
  province?: string;
  cityKey?: string;
} {
  const raw = address.replace(/\s+/g, " ").trim();
  let province: string | undefined;
  for (const [re, code] of PROV_FROM_ADDR) {
    if (re.test(raw)) {
      province = code;
      break;
    }
  }
  // "서울특별시 강북구" / "경기도 가평군"
  const m =
    raw.match(
      /(?:특별자치시|광역시|특별시|도)\s*([가-힣]+(?:시|군|구)(?:\s*[가-힣]+구)?)/,
    ) || raw.match(/\s([가-힣]+(?:시|군|구))\s/);
  const cityKey = m ? stripAdmin(m[1]) : undefined;
  return { province, cityKey };
}

export type MountainMarker = {
  x: number;
  y: number;
  /** geocode=카카오 좌표, emd/시군구=행정 중심 근사 */
  precision: "geocode" | "sigungu" | "emd";
  placeName?: string;
};

export type MountainRegionLink = {
  mapRegion?: RegionStat;
  adminRegion?: AdminRegion;
  emdRegion?: AdminRegion;
  marker?: MountainMarker;
};

/** 주소에서 읍·면·동·리 힌트 추출 */
export function parseTownHint(address: string): string[] {
  const raw = address.replace(/\s+/g, " ").trim();
  const hints: string[] = [];
  // 예: 북면, 송지면, 우이동, 목동리
  const re = /([가-힣]+(?:읍|면|동|리|가))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    hints.push(m[1]);
  }
  return hints;
}

function findEmdForMountain(
  mountain: MountainInfo,
  adminSigungu: AdminRegion | undefined,
  adminEmd: AdminRegion[],
): AdminRegion | undefined {
  if (!adminSigungu || !adminEmd.length) return undefined;
  const prefix = adminSigungu.code.slice(0, 5);
  const candidates = adminEmd.filter((e) => e.code.startsWith(prefix));
  if (!candidates.length) return undefined;

  const towns = parseTownHint(mountain.address || "");
  for (const town of towns) {
    const core = stripAdmin(town);
    const hit = candidates.find((e) => {
      const n = e.name.replace(/\s+/g, "");
      const nc = stripAdmin(e.name);
      return (
        n === town ||
        nc === core ||
        n.includes(town) ||
        town.includes(n) ||
        (core.length >= 2 && nc.includes(core))
      );
    });
    if (hit) return hit;
  }
  return undefined;
}

/** 산을 지도 지역·행정 시군구·마커 좌표에 연결 */
export function linkMountainToRegions(
  mountain: MountainInfo,
  mapRegions: RegionStat[],
  adminSigungu: AdminRegion[],
  adminEmd: AdminRegion[] = [],
): MountainRegionLink {
  // 1) map-data catalog/top 에 포함된 지역
  let mapRegion = mapRegions.find(
    (r) =>
      r.catalog_mountains?.some(
        (m) => m.id === mountain.id || m.name === mountain.name,
      ) ||
      r.top_mountains?.some(
        (m) => m.id === mountain.id || m.name === mountain.name,
      ),
  );

  const hint = parseAddressHint(mountain.address || "");

  // 2) 주소로 map-data 지역 매칭
  if (!mapRegion && hint.cityKey) {
    mapRegion = mapRegions.find((r) => {
      const sameProv = !hint.province || r.province === hint.province;
      return sameProv && stripAdmin(r.name) === hint.cityKey;
    });
  }

  // 3) admin-sigungu (ML·이력 색용 코드)
  let adminRegion = adminSigungu.find((r) => {
    if (hint.province && r.province !== hint.province) return false;
    if (hint.cityKey && stripAdmin(r.name) === hint.cityKey) return true;
    return false;
  });

  if (!adminRegion && mapRegion) {
    adminRegion = adminSigungu.find(
      (r) =>
        r.province === mapRegion!.province &&
        stripAdmin(r.name) === stripAdmin(mapRegion!.name),
    );
  }

  // 구 이름만 (예: 만세구) — 화성시 만세구
  if (!adminRegion && hint.cityKey) {
    adminRegion = adminSigungu.find(
      (r) =>
        (!hint.province || r.province === hint.province) &&
        (stripAdmin(r.name) === hint.cityKey ||
          r.name.replace(/\s+/g, "").includes(hint.cityKey!)),
    );
  }

  const emdRegion = findEmdForMountain(mountain, adminRegion, adminEmd);

  let marker: MountainMarker | undefined;
  // 1) 카카오 지오코딩 SVG 좌표 우선
  if (
    mountain.svg_x != null &&
    mountain.svg_y != null &&
    Number.isFinite(mountain.svg_x) &&
    Number.isFinite(mountain.svg_y)
  ) {
    marker = {
      x: mountain.svg_x,
      y: mountain.svg_y,
      precision: "geocode",
      placeName: mountain.address || mountain.name,
    };
  } else if (emdRegion) {
    marker = {
      x: emdRegion.x,
      y: emdRegion.y,
      precision: "emd",
      placeName: emdRegion.name,
    };
  } else if (adminRegion) {
    marker = {
      x: adminRegion.x,
      y: adminRegion.y,
      precision: "sigungu",
      placeName: adminRegion.name,
    };
  } else if (mapRegion?.center) {
    marker = {
      x: mapRegion.center[0],
      y: mapRegion.center[1],
      precision: "sigungu",
      placeName: mapRegion.name,
    };
  }

  return { mapRegion, adminRegion, emdRegion, marker };
}
