/**
 * 지역 질의 문자열로 예측 regions / map-data regions 필터.
 */
import type { DailyRiskRegion } from "../types.js";

const PROVINCE_ALIASES: { keys: string[]; match: string }[] = [
  { keys: ["서울", "서울시", "서울특별시"], match: "서울" },
  { keys: ["부산", "부산시", "부산광역시"], match: "부산" },
  { keys: ["대구", "대구시", "대구광역시"], match: "대구" },
  { keys: ["인천", "인천시", "인천광역시"], match: "인천" },
  { keys: ["광주", "광주시", "광주광역시"], match: "광주" },
  { keys: ["대전", "대전시", "대전광역시"], match: "대전" },
  { keys: ["울산", "울산시", "울산광역시"], match: "울산" },
  { keys: ["세종", "세종시", "세종특별자치시"], match: "세종" },
  { keys: ["경기", "경기도"], match: "경기" },
  { keys: ["강원", "강원도", "강원특별자치도"], match: "강원" },
  { keys: ["충북", "충청북도"], match: "충북" },
  { keys: ["충남", "충청남도"], match: "충남" },
  { keys: ["전북", "전라북도", "전북특별자치도"], match: "전북" },
  { keys: ["전남", "전라남도", "전라도"], match: "전남" },
  { keys: ["경북", "경상북도"], match: "경북" },
  { keys: ["경남", "경상남도"], match: "경남" },
  { keys: ["제주", "제주도", "제주특별자치도"], match: "제주" },
];

export function resolveRegionFocus(query: string | null | undefined): {
  label: string;
  provinceNeedle: string | null;
  nameNeedle: string | null;
} {
  const q = String(query || "").trim();
  if (!q) {
    return { label: "전국", provinceNeedle: null, nameNeedle: null };
  }

  for (const row of PROVINCE_ALIASES) {
    if (row.keys.some((k) => q.includes(k))) {
      return { label: row.match, provinceNeedle: row.match, nameNeedle: null };
    }
  }

  // 시군구명 힌트 (짧은 토큰)
  const cleaned = q
    .replace(/오늘|당일|산불|발생|위험도|위험|예측|보고서|리포트|만들어|주세요|해줘|알려|지역/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length >= 2) {
    return { label: cleaned, provinceNeedle: null, nameNeedle: cleaned };
  }
  return { label: q, provinceNeedle: null, nameNeedle: q };
}

export function filterRiskRegions(
  regions: DailyRiskRegion[],
  focus: ReturnType<typeof resolveRegionFocus>,
): DailyRiskRegion[] {
  if (!focus.provinceNeedle && !focus.nameNeedle) return regions;
  return regions.filter((r) => {
    const name = String(r.name ?? "");
    const prov = String(r.province ?? "");
    if (focus.provinceNeedle) {
      return prov.includes(focus.provinceNeedle) || name.includes(focus.provinceNeedle);
    }
    if (focus.nameNeedle) {
      return name.includes(focus.nameNeedle) || prov.includes(focus.nameNeedle);
    }
    return true;
  });
}

export function wantsPdfReport(message: string): boolean {
  return /보고서|리포트|\bpdf\b/i.test(message);
}
