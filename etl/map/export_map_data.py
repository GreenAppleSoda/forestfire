"""시군구 단위 산불 밀도 + 이력 + 산 메타 → frontend/public/data/map-data.json"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import json
import re

import pandas as pd

from paths import (
    CITY_RISK,
    KOREA_SIGUNGU_PATHS,
    MAP_DATA_JSON,
    MOUNTAIN_COORDS,
    MOUNTAIN_DATA,
    MOUNTAIN_LOCATION,
    REFINED_WILDFIRE,
    WILDFIRE_BY_MOUNTAIN,
    WILDFIRE_MOUNTAIN_EVENTS,
    WILDFIRE_WITH_MOUNTAINS,
    ensure_dirs,
)

OUT = MAP_DATA_JSON
PATHS_FILE = KOREA_SIGUNGU_PATHS

PROVINCE_FULL = {
    "서울": "서울특별시",
    "부산": "부산광역시",
    "대구": "대구광역시",
    "인천": "인천광역시",
    "광주": "광주광역시",
    "대전": "대전광역시",
    "울산": "울산광역시",
    "세종": "세종특별자치시",
    "경기": "경기도",
    "강원": "강원특별자치도",
    "충북": "충청북도",
    "충남": "충청남도",
    "전북": "전북특별자치도",
    "전남": "전라남도",
    "경북": "경상북도",
    "경남": "경상남도",
    "제주": "제주특별자치도",
}


def lerp_color(t: float) -> str:
    t = max(0.0, min(1.0, t))
    stops = [
        (0.0, (37, 99, 235)),
        (0.35, (56, 189, 248)),
        (0.7, (245, 158, 11)),
        (1.0, (220, 38, 38)),
    ]
    for i in range(len(stops) - 1):
        t0, c0 = stops[i]
        t1, c1 = stops[i + 1]
        if t <= t1 or i == len(stops) - 2:
            u = 0 if t1 == t0 else (t - t0) / (t1 - t0)
            u = max(0.0, min(1.0, u))
            r = int(c0[0] + (c1[0] - c0[0]) * u)
            g = int(c0[1] + (c1[1] - c0[1]) * u)
            b = int(c0[2] + (c1[2] - c0[2]) * u)
            return f"#{r:02X}{g:02X}{b:02X}"
    return "#DC2626"


def snippet(text: object, limit: int = 220) -> str:
    if text is None or (isinstance(text, float) and pd.isna(text)):
        return ""
    s = re.sub(r"\s+", " ", str(text)).strip()
    if s.lower() in {"", "nan", "none", "null", "( - )", "(-)"}:
        return ""
    if len(s) <= limit:
        return s
    return s[: limit - 1].rstrip() + "…"


def mountain_payload(
    row: pd.Series,
    fire_count: int = 0,
    coords_by_id: dict[str, dict] | None = None,
) -> dict:
    height = row.get("mntn_hght")
    try:
        height_val = None if pd.isna(height) else round(float(height), 1)
    except (TypeError, ValueError):
        height_val = None
    mid = str(row.get("mntn_id", "") or "")
    payload = {
        "id": mid,
        "name": str(row.get("mntn_nm", "") or ""),
        "height": height_val,
        "address": str(row.get("mntn_add", "") or ""),
        "details": snippet(row.get("mntn_details"), 280),
        "notable": snippet(row.get("mntn_notable"), 220),
        "admin": str(row.get("mntn_admin", "") or ""),
        "admin_tel": str(row.get("mntn_admin_tel", "") or ""),
        "fire_count": int(fire_count),
    }
    c = (coords_by_id or {}).get(mid) or {}
    lon, lat = c.get("lon"), c.get("lat")
    sx, sy = c.get("svg_x"), c.get("svg_y")
    if lon is not None and lat is not None and pd.notna(lon) and pd.notna(lat):
        payload["lon"] = float(lon)
        payload["lat"] = float(lat)
    if sx is not None and sy is not None and pd.notna(sx) and pd.notna(sy):
        payload["svg_x"] = float(sx)
        payload["svg_y"] = float(sy)
    return payload


def load_coords_by_id() -> dict[str, dict]:
    if not MOUNTAIN_COORDS.exists():
        return {}
    df = pd.read_csv(MOUNTAIN_COORDS, encoding="utf-8-sig")
    if "mntn_id" not in df.columns:
        return {}
    df["mntn_id"] = df["mntn_id"].astype(str).str.replace(r"\.0$", "", regex=True)
    out: dict[str, dict] = {}
    for _, r in df.iterrows():
        if not bool(r.get("ok")):
            continue
        if pd.isna(r.get("lon")) or pd.isna(r.get("svg_x")):
            continue
        out[str(r["mntn_id"])] = {
            "lon": float(r["lon"]),
            "lat": float(r["lat"]),
            "svg_x": float(r["svg_x"]),
            "svg_y": float(r["svg_y"]),
        }
    return out


def strip_suffix(name: str) -> str:
    name = name.strip()
    name = re.sub(r"\s+", "", name)
    name = re.sub(r"(특별자치시|광역시|특별시)$", "", name)
    name = re.sub(r"(시|군|구)$", "", name)
    return name


def geo_name_keys(name: str) -> list[str]:
    """창원시의창구 → ['창원의창', '의창', '창원'] 등 매칭 키."""
    raw = re.sub(r"\s+", "", name.strip())
    keys: list[str] = []

    # 창원시의창구 / 포항시남구 / 수원시장안구
    m = re.match(r"^(.+?시)(.+구)$", raw)
    if m:
        city, gu = m.group(1), m.group(2)
        city_n = strip_suffix(city)
        gu_n = strip_suffix(gu)
        keys.extend(
            [
                f"{city_n}{gu_n}",
                f"{city_n} {gu_n}",
                gu_n,
                city_n,
            ]
        )
    else:
        keys.append(strip_suffix(raw))
        keys.append(raw)

    # 세종시
    if raw.startswith("세종"):
        keys.append("세종")

    out = []
    seen = set()
    for k in keys:
        k = k.strip()
        if k and k not in seen:
            seen.add(k)
            out.append(k)
    return out


def fire_city_keys(city: str) -> list[str]:
    city = str(city).strip()
    if not city or city.lower() in {"unknown", "nan"}:
        return []
    compact = re.sub(r"\s+", "", city)
    spaced = re.sub(r"\s+", " ", city)
    keys = [compact, spaced, strip_suffix(compact)]
    # 청주상당 → 청주 상당
    m = re.match(r"^([가-힣]+?)(상당|서원|흥덕|청원|동남|서북|장안|권선|팔달|영통|수정|중원|분당|만안|동안|상록|단원|처인|기흥|수지구|의창|성산|진해|마산합포|마산회원|남|북)$", compact)
    if m:
        keys.append(f"{m.group(1)} {m.group(2)}")
        keys.append(m.group(2))
        keys.append(m.group(1))
    out = []
    seen = set()
    for k in keys:
        k = k.strip()
        if k and k not in seen:
            seen.add(k)
            out.append(k)
    return out


def build_feature_index(paths: dict) -> list[dict]:
    features = []
    for r in paths["regions"]:
        province = r["province"]
        name = r["name"]
        keys = geo_name_keys(name)
        features.append(
            {
                "code": r["code"],
                "name": name,
                "province": province,
                "province_name": PROVINCE_FULL.get(province, province),
                "keys": keys,
                "label": r["label"],
            }
        )
    return features


def match_fire_to_feature(
    province: str, city: str, features: list[dict]
) -> list[dict]:
    """한 산불 시군구 → 매칭되는 geo feature들 (구 단위 여러 개일 수 있음)."""
    if province == "세종":
        return [f for f in features if f["province"] == "세종"]

    fkeys = fire_city_keys(city)
    if not fkeys:
        return []

    cand = [f for f in features if f["province"] == province]
    hits = []
    for f in cand:
        gkeys = f["keys"]
        if any(fk in gkeys or gk == fk for fk in fkeys for gk in gkeys):
            hits.append(f)
            continue
        # 부모시만 있는 경우: 고양 → 고양시*구 전부
        parent = fkeys[0]
        if any(gk.startswith(parent) or parent.startswith(gk) for gk in gkeys if len(parent) >= 2):
            # 더 엄격: geo key가 parent로 시작하거나 parent가 geo의 시 이름
            if any(
                gk == parent
                or gk.startswith(parent)
                or parent.startswith(gk)
                for gk in gkeys
            ):
                hits.append(f)

    # 중복 제거 후, 정확히 매칭된 것만 우선
    exact = []
    soft = []
    for f in hits:
        if any(fk in f["keys"] for fk in fkeys):
            exact.append(f)
        else:
            soft.append(f)
    chosen = exact or soft
    # 고유 code
    seen = set()
    out = []
    for f in chosen:
        if f["code"] in seen:
            continue
        seen.add(f["code"])
        out.append(f)
    return out


def main() -> None:
    ensure_dirs()
    if not PATHS_FILE.exists():
        raise FileNotFoundError(
            f"{PATHS_FILE} 없음. 먼저 node etl/map/build_sigungu_paths.mjs 실행"
        )

    paths = json.loads(PATHS_FILE.read_text(encoding="utf-8"))
    features = build_feature_index(paths)

    fires = pd.read_csv(WILDFIRE_WITH_MOUNTAINS)
    fires["datetime"] = pd.to_datetime(fires["datetime"], errors="coerce")
    fires = fires.sort_values("datetime", ascending=False)

    events = pd.read_csv(WILDFIRE_MOUNTAIN_EVENTS)
    mountains = pd.read_csv(MOUNTAIN_DATA)
    loc = pd.read_csv(MOUNTAIN_LOCATION)
    by_mtn = (
        pd.read_csv(WILDFIRE_BY_MOUNTAIN)
        if WILDFIRE_BY_MOUNTAIN.exists()
        else pd.DataFrame()
    )
    city_risk = pd.read_csv(CITY_RISK) if CITY_RISK.exists() else pd.DataFrame()

    mountains["mntn_id"] = mountains["mntn_id"].astype(str).str.replace(r"\.0$", "", regex=True)
    mountains["mntn_hght"] = pd.to_numeric(mountains["mntn_hght"], errors="coerce")
    for c in ["mntn_details", "mntn_notable", "mntn_summary", "mntn_admin", "mntn_admin_tel", "mntn_add", "mntn_nm"]:
        if c not in mountains.columns:
            mountains[c] = ""
        mountains[c] = mountains[c].fillna("").astype(str)
    mtn_meta = mountains.drop_duplicates("mntn_id").set_index("mntn_id", drop=False)
    coords_by_id = load_coords_by_id()
    print(f"산 좌표 로드: {len(coords_by_id)}개 (geocode 성공분)")

    def mp(row: pd.Series, fire_count: int = 0) -> dict:
        return mountain_payload(row, fire_count, coords_by_id)

    fire_counts_mtn: dict[str, int] = {}
    if not by_mtn.empty and "mntn_id" in by_mtn.columns:
        by_mtn["mntn_id"] = by_mtn["mntn_id"].astype(str).str.replace(r"\.0$", "", regex=True)
        for _, r in by_mtn.iterrows():
            fire_counts_mtn[str(r["mntn_id"])] = int(r.get("fire_event_count", 0) or 0)

    loc = loc[loc["province"].isin(PROVINCE_FULL.keys())].copy()
    loc["mntn_id"] = loc["mntn_id"].astype(str).str.replace(r"\.0$", "", regex=True)
    loc["mntn_hght"] = pd.to_numeric(loc["mntn_hght"], errors="coerce")
    if "mntn_notable" not in loc.columns:
        loc["mntn_notable"] = ""
    loc["mntn_notable"] = loc["mntn_notable"].fillna("").astype(str)

    # feature code → fire ids
    feature_fires: dict[str, list[int]] = {f["code"]: [] for f in features}
    fire_feature_codes: dict[int, list[str]] = {}

    for idx, row in fires.iterrows():
        fid = int(row["fire_id"]) if "fire_id" in row and pd.notna(row["fire_id"]) else int(idx)
        prov = str(row.get("fire_province", "") or "").strip()
        city = str(row.get("fire_city", "") or "").strip()
        matched = match_fire_to_feature(prov, city, features)
        codes = [m["code"] for m in matched]
        fire_feature_codes[fid] = codes
        for code in codes:
            feature_fires[code].append(fid)

    # risk lookup by city_key
    risk_by_key = {}
    if not city_risk.empty:
        for _, r in city_risk.iterrows():
            risk_by_key[str(r["city_key"]).strip()] = r

    max_count = max((len(v) for v in feature_fires.values()), default=1) or 1

    regions_out = []
    history: dict[str, list] = {}
    mountain_index: dict[str, dict] = {}

    for feat in features:
        code = feat["code"]
        fids = feature_fires[code]
        fire_count = len(fids)
        intensity = fire_count / max_count if max_count else 0

        # risk from city_key if available
        city_key_candidates = [f"{feat['province']} {k}" for k in feat["keys"]]
        risk_row = None
        for ck in city_key_candidates:
            if ck in risk_by_key:
                risk_row = risk_by_key[ck]
                break

        risk_score = float(risk_row["risk_score"]) if risk_row is not None else round(intensity * 100, 1)
        risk_tier = str(risk_row["risk_tier_name"]) if risk_row is not None else (
            "고위험" if intensity > 0.6 else "주의" if intensity > 0.25 else "낮음"
        )
        large_pct = float(risk_row["large_fire_pct"]) if risk_row is not None else 0.0

        # mountains in same city (approx by city name in loc)
        city_norm = strip_suffix(feat["name"])
        # for 구: use parent city for mountain filter when possible
        m = re.match(r"^(.+?시)(.+구)$", re.sub(r"\s+", "", feat["name"]))
        city_for_mtn = strip_suffix(m.group(1)) if m else city_norm

        prov_loc = loc[
            (loc["province"] == feat["province"])
            & (
                loc["city"].astype(str).str.contains(city_for_mtn, regex=False)
                | (loc["city"].astype(str) == city_for_mtn)
            )
        ].drop_duplicates("mntn_id")
        if prov_loc.empty:
            prov_loc = loc[loc["province"] == feat["province"]].drop_duplicates("mntn_id").head(0)

        mountain_count = int(len(prov_loc)) if len(prov_loc) else int(
            len(loc[loc["province"] == feat["province"]].drop_duplicates("mntn_id"))
            if feat["province"] == "세종"
            else 0
        )
        if feat["province"] == "세종":
            prov_loc = loc[loc["province"] == "세종"].drop_duplicates("mntn_id")
            mountain_count = int(len(prov_loc))

        # catalog
        catalog_ids: list[str] = []
        notable = prov_loc[prov_loc["mntn_notable"].str.strip().ne("")]
        for mid in notable.sort_values("mntn_hght", ascending=False)["mntn_id"].astype(str):
            if mid not in catalog_ids:
                catalog_ids.append(mid)
        for mid in prov_loc.sort_values("mntn_hght", ascending=False)["mntn_id"].astype(str):
            if mid not in catalog_ids:
                catalog_ids.append(mid)
            if len(catalog_ids) >= 14:
                break

        catalog = []
        for mid in catalog_ids[:14]:
            if mid in mtn_meta.index:
                catalog.append(mp(mtn_meta.loc[mid], fire_counts_mtn.get(mid, 0)))

        # top mountains from events for these fires
        top_mountains = []
        if fids and not events.empty:
            sub = events[
                events["fire_id"].isin(fids)
                & events["mntn_id"].notna()
            ].copy()
            sub["mntn_id"] = sub["mntn_id"].astype(str).str.replace(r"\.0$", "", regex=True)
            sub = sub[sub["mntn_id"].ne("") & sub["mntn_id"].ne("nan")]
            vc = sub["mntn_id"].value_counts().head(10)
            for mid, cnt in vc.items():
                if mid in mtn_meta.index:
                    top_mountains.append(
                        mp(mtn_meta.loc[mid], int(cnt))
                    )

        regions_out.append(
            {
                "code": code,
                "name": feat["name"],
                "province": feat["province"],
                "province_name": feat["province_name"],
                "fire_count": fire_count,
                "risk_score": round(float(risk_score), 1),
                "risk_tier": risk_tier,
                "large_fire_pct": round(float(large_pct), 1),
                "intensity": round(intensity, 4),
                "color": lerp_color(intensity) if fire_count > 0 else "#93C5FD",
                "center": feat["label"],
                "mountain_count": mountain_count,
                "top_mountains": top_mountains,
                "catalog_mountains": catalog,
            }
        )

        # history
        hist = []
        if fids:
            sub_fires = fires[fires["fire_id"].isin(fids)] if "fire_id" in fires.columns else fires.iloc[0:0]
            if sub_fires.empty:
                # fallback by index list order
                sub_fires = fires.loc[fires.index.isin(fids)] if False else fires.head(0)
            # rebuild from fire_id column
            if "fire_id" in fires.columns:
                sub_fires = fires[fires["fire_id"].isin(fids)].copy()
            else:
                sub_fires = fires.iloc[0:0]

            sub_fires = sub_fires.copy()
            sub_fires["_has_mtn"] = (
                sub_fires["mountain_names"].fillna("").astype(str).str.strip().ne("")
                & sub_fires["mountain_names"].fillna("").astype(str).str.lower().ne("nan")
            )
            recent = pd.concat(
                [
                    sub_fires[sub_fires["_has_mtn"]].head(20),
                    sub_fires[~sub_fires["_has_mtn"]].head(8),
                ],
                ignore_index=True,
            ).head(28)

            for _, r in recent.iterrows():
                names_raw = str(r.get("mountain_names", "") or "").strip()
                if names_raw.lower() in {"", "nan", "none", "null"}:
                    names_raw = ""
                ids_raw = str(r.get("mountain_ids", "") or "").strip()
                if ids_raw.lower() in {"", "nan", "none", "null"}:
                    ids_raw = ""
                names = [n.strip() for n in names_raw.split(",") if n.strip()]
                ids = [i.strip() for i in ids_raw.split(",") if i.strip()]
                linked = []
                for i, mid in enumerate(ids[:10]):
                    mid = mid.replace(".0", "") if mid.endswith(".0") else mid
                    if mid in mtn_meta.index:
                        linked.append(
                            mp(mtn_meta.loc[mid], fire_counts_mtn.get(mid, 0))
                        )
                        mountain_index[mid] = linked[-1]
                    elif i < len(names):
                        linked.append(
                            {
                                "id": mid,
                                "name": names[i],
                                "height": None,
                                "address": "",
                                "details": "",
                                "notable": "",
                                "admin": "",
                                "admin_tel": "",
                                "fire_count": 0,
                            }
                        )
                if not linked and names:
                    for name in names[:8]:
                        hit = mountains[mountains["mntn_nm"] == name]
                        if len(hit):
                            mid = str(hit.iloc[0]["mntn_id"])
                            linked.append(
                                mp(hit.iloc[0], fire_counts_mtn.get(mid, 0))
                            )
                            mountain_index[mid] = linked[-1]
                        else:
                            linked.append(
                                {
                                    "id": "",
                                    "name": name,
                                    "height": None,
                                    "address": "",
                                    "details": "",
                                    "notable": "",
                                    "admin": "",
                                    "admin_tel": "",
                                    "fire_count": 0,
                                }
                            )

                hist.append(
                    {
                        "datetime": "" if pd.isna(r["datetime"]) else str(r["datetime"]),
                        "region": str(r.get("fire_region", "") or ""),
                        "city": str(r.get("fire_city", "") or ""),
                        "town": str(r.get("fire_town", "") or ""),
                        "village": str(r.get("fire_village", "") or ""),
                        "damage_area": float(r["damage_area"]) if pd.notna(r["damage_area"]) else 0,
                        "mountains": names_raw,
                        "mountain_list": linked,
                        "match_level": str(r.get("match_level", "") or ""),
                    }
                )
        history[code] = hist

        for m in top_mountains + catalog:
            if m["id"]:
                mountain_index[m["id"]] = m

    # 전체 산 카탈로그 + 지오코딩 좌표 병합 (검색용)
    for mid, row in mtn_meta.iterrows():
        mid_s = str(mid)
        if mid_s in mountain_index:
            # 좌표만 보강
            base = mountain_index[mid_s]
            enriched = mp(row, int(base.get("fire_count") or fire_counts_mtn.get(mid_s, 0)))
            for k in ("lon", "lat", "svg_x", "svg_y"):
                if k in enriched:
                    base[k] = enriched[k]
        else:
            mountain_index[mid_s] = mp(row, fire_counts_mtn.get(mid_s, 0))

    regions_out.sort(key=lambda x: x["fire_count"], reverse=True)

    matched_feature_fires = sum(1 for v in feature_fires.values() if v)
    n_with_xy = sum(1 for m in mountain_index.values() if m.get("svg_x") is not None)
    payload = {
        "meta": {
            "source": "korea_mountains.json + wildfire_with_mountains + sigungu + kakao_geocode",
            "unit": "시군구",
            "color": "blue(safe) → red(many fires)",
            "total_fires": int(len(pd.read_csv(REFINED_WILDFIRE))),
            "total_mountains": int(len(mountain_index)),
            "mountains_with_coords": n_with_xy,
            "matched_fires": int((fires["match_level"] != "none").sum())
            if "match_level" in fires.columns
            else 0,
            "regions": len(regions_out),
            "regions_with_fires": matched_feature_fires,
        },
        "provinces": regions_out,  # 호환: 프론트에서 regions로도 씀
        "regions": regions_out,
        "history": history,
        "mountains": mountain_index,
    }

    OUT.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    size_mb = OUT.stat().st_size / 1e6
    with_fire = sum(1 for r in regions_out if r["fire_count"] > 0)
    print(
        f"저장: {OUT} ({len(regions_out)} 시군구, 산불있는곳 {with_fire}, "
        f"산 {len(mountain_index)}개 중 좌표 {n_with_xy}, {size_mb:.2f}MB)"
    )


if __name__ == "__main__":
    main()
