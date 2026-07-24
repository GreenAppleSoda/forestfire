import type { GeoFeatureCollection, ProvinceStat } from "./types";

/** GeoJSON 시도명 → 내부 코드 */
export const GEO_NAME_TO_CODE: Record<string, string> = {
  서울특별시: "서울",
  부산광역시: "부산",
  대구광역시: "대구",
  인천광역시: "인천",
  광주광역시: "광주",
  대전광역시: "대전",
  울산광역시: "울산",
  세종특별자치시: "세종",
  경기도: "경기",
  강원도: "강원",
  강원특별자치도: "강원",
  충청북도: "충북",
  충청남도: "충남",
  전라북도: "전북",
  전북특별자치도: "전북",
  전라남도: "전남",
  경상북도: "경북",
  경상남도: "경남",
  제주특별자치도: "제주",
};

export type RegionFeature = {
  code: string;
  name: string;
  feature: GeoFeatureCollection["features"][number];
  province: ProvinceStat;
};

export function buildRegionFeatures(
  geo: GeoFeatureCollection,
  provinces: ProvinceStat[],
): RegionFeature[] {
  const byCode = new Map(provinces.map((p) => [p.code, p]));
  const out: RegionFeature[] = [];

  for (const feature of geo.features) {
    const code = GEO_NAME_TO_CODE[feature.properties.name];
    if (!code) continue;
    const province = byCode.get(code);
    if (!province) continue;
    out.push({
      code,
      name: province.name,
      feature,
      province,
    });
  }
  return out;
}
