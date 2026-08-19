/**
 * 지역 질의 문자열로 예측 regions / map-data regions 필터.
 * 챗봇 PDF 요청 시에는 현재 문장 + 대화 히스토리에서 지역을 찾는다.
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

const NOISE_RE =
  /오늘|당일|산불|발생|위험도|위험|예측|보고서|리포트|만들어줘|만들어|주세요|해줘|알려줘|알려|지역|pdf|피디에프|좀더|제발|상세|분석|포함|슬라이드|생성|원하|궁금|해당|요청|부탁|다운로드|받아줘|파일|만들|해달|달라|대해|관해|관련|말씀|질문|안내|어때|어떤|어떻게/gi;

const FILLER_TOKENS = new Set([
  "하나",
  "좀",
  "제발",
  "그것",
  "그거",
  "이거",
  "저거",
  "그것좀",
  "바로",
  "지금",
  "다시",
  "한번",
  "한장",
  "파일",
]);

export type RegionFocus = {
  label: string;
  provinceNeedle: string | null;
  nameNeedle: string | null;
};

/** 예시 문장·따옴표 안 템플릿은 지역 힌트에서 제외 */
function stripExampleHints(text: string): string {
  return text
    .replace(/예시\s*\)[^\n]*/g, " ")
    .replace(/예\s*\)[^\n]*/g, " ")
    .replace(/예:\s*[^\n]*/g, " ")
    .replace(/「[^」]*」/g, " ")
    .replace(/"[^"]*"/g, " ")
    .replace(/'[^']*'/g, " ");
}

/**
 * 문장에서 확신 있는 지역 라벨만 추출. 없으면 null.
 * (잡음이 label 로 들어가는 것을 막음)
 */
export function extractRegionLabel(query: string | null | undefined): string | null {
  const raw = stripExampleHints(String(query || "")).trim();
  if (!raw) return null;

  if (/전국|대한민국|나라\s*전체|전체\s*지역/.test(raw)) {
    return "전국";
  }

  // 긴 키부터 (서울특별시 > 서울)
  const sortedAliases = [...PROVINCE_ALIASES].sort(
    (a, b) => Math.max(...b.keys.map((k) => k.length)) - Math.max(...a.keys.map((k) => k.length)),
  );
  for (const row of sortedAliases) {
    if (row.keys.some((k) => raw.includes(k))) {
      return row.match;
    }
  }

  // 시·군·구 패턴
  const m = raw.match(/([가-힣]{1,12}(?:특별자치시|광역시|특별시|시|군|구))/);
  if (m?.[1] && m[1].length >= 2) {
    return m[1];
  }

  const cleaned = raw
    .replace(NOISE_RE, " ")
    .replace(/[^\w가-힣\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return null;

  const tokens = cleaned.split(" ").filter((t) => t.length >= 2 && !FILLER_TOKENS.has(t));
  const token = tokens[0];
  if (tokens.length === 1 && token && /^[가-힣]{2,12}$/.test(token)) {
    return token;
  }
  return null;
}

export function resolveRegionFocus(query: string | null | undefined): RegionFocus {
  const label = extractRegionLabel(query);
  if (!label || label === "전국") {
    return { label: "전국", provinceNeedle: null, nameNeedle: null };
  }

  for (const row of PROVINCE_ALIASES) {
    if (row.match === label || row.keys.includes(label)) {
      return { label: row.match, provinceNeedle: row.match, nameNeedle: null };
    }
  }

  return { label, provinceNeedle: null, nameNeedle: label };
}

/**
 * PDF용: 현재 메시지 → 최근 유저 발화 → (예시 제외) 어시스턴트 발화 순으로 지역 탐색.
 * 그래도 없으면 null (호출측에서 되묻기).
 */
export function resolveRegionFocusForPdf(
  message: string,
  history: { role: string; content: string }[],
): RegionFocus | null {
  const fromMessage = extractRegionLabel(message);
  if (fromMessage) return resolveRegionFocus(fromMessage);

  for (let i = history.length - 1; i >= 0; i--) {
    const h = history[i];
    if (!h || h.role !== "user") continue;
    const label = extractRegionLabel(h.content);
    if (label) return resolveRegionFocus(label);
  }

  for (let i = history.length - 1; i >= 0; i--) {
    const h = history[i];
    if (!h || h.role !== "assistant") continue;
    const label = extractRegionLabel(h.content);
    if (label) return resolveRegionFocus(label);
  }

  return null;
}

export function filterRiskRegions(
  regions: DailyRiskRegion[],
  focus: RegionFocus,
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
