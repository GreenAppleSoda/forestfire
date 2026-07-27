"""
ASOS 일자료 전처리 + 관측지점→시군구 매핑 + 시군구×일 기상표 생성.

입력: db-archive/raw/weather/asos_daily_2011_2026.csv (cp949)
출력:
  db-archive/processed/weather_daily_asos.csv       # 지점 일자료(정리)
  db-archive/processed/asos_station_sigungu_map.csv # 지점↔대표 시군구
  db/processed/weather_daily_sigungu.csv            # 시군구×일 (예측 런타임)
  db/processed/sigungu_asos_station.csv             # 시군구→지점 (예측 런타임)
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import json
import math
import re

import pandas as pd

from paths import (
    ADMIN_SIGUNGU_JSON,
    ASOS_STATION_SIGUNGU_MAP,
    DATA_PROCESSED_ETL,
    DATA_RAW,
    RAW_ASOS_DAILY,
    ROOT,
    SIGUNGU_ASOS_STATION,
    WEATHER_DAILY_ASOS,
    WEATHER_DAILY_SIGUNGU,
    ensure_dirs,
)

RAW_ASOS = RAW_ASOS_DAILY
OUT_ASOS = WEATHER_DAILY_ASOS
OUT_MAP = ASOS_STATION_SIGUNGU_MAP
OUT_SIGUNGU = WEATHER_DAILY_SIGUNGU
ADMIN_SIGUNGU = ADMIN_SIGUNGU_JSON

# 지점명 → 매칭용 시군구/도시 키 (관측소명이 행정명과 다를 때)
STATION_NAME_OVERRIDE = {
    "북춘천": "춘천",
    "북강릉": "강릉",
    "서청주": "청주",
    "북창원": "창원",
    "북부산": "부산",
    "대관령": "평창",
    "추풍령": "김천",
    "백령도": "옹진",
    "흑산도": "신안",
    "울릉도": "울릉",
    "고산": "제주",  # 제주 서쪽
    "성산": "서귀포",
    "고창": "고창",
    "고창군": "고창",
    "영광군": "영광",
    "김해시": "김해",
    "순창군": "순창",
    "양산시": "양산",
    "보성군": "보성",
    "강진군": "강진",
    "의령군": "의령",
    "함양군": "함양",
    "광양시": "광양",
    "진도군": "진도",
    "청송군": "청송",
    "경주시": "경주",
    "정선군": "정선",
}


def strip_admin(name: str) -> str:
    name = re.sub(r"\s+", "", str(name).strip())
    name = re.sub(r"(특별자치시|광역시|특별시|특별자치도)$", "", name)
    name = re.sub(r"(시|군|구)$", "", name)
    return name


def load_sigungu() -> pd.DataFrame:
    data = json.loads(ADMIN_SIGUNGU.read_text(encoding="utf-8"))
    rows = []
    for r in data["regions"]:
        rows.append(
            {
                "sigungu_code": r["code"],
                "sigungu_name": r["name"],
                "province": r["province"],
                "province_name": r.get("province_name", ""),
                "x": float(r["label"][0]),
                "y": float(r["label"][1]),
                "key": strip_admin(r["name"]),
            }
        )
    return pd.DataFrame(rows)


def preprocess_asos(path: Path) -> pd.DataFrame:
    df = pd.read_csv(path, encoding="cp949")
    # 컬럼 순서는 다운로드 스펙 고정
    expected_n = 11
    if len(df.columns) != expected_n:
        raise ValueError(f"예상 컬럼 {expected_n}개, 실제 {len(df.columns)}개: {list(df.columns)}")

    df.columns = [
        "stn_id",
        "stn_name",
        "date",
        "temp_avg",
        "temp_min",
        "temp_max",
        "precip",
        "wind_max",
        "wind_avg",
        "humidity_min",
        "humidity_avg",
    ]
    df["date"] = pd.to_datetime(df["date"], errors="coerce")
    df = df.dropna(subset=["date", "stn_id"]).copy()
    df["stn_id"] = df["stn_id"].astype(int)
    df["stn_name"] = df["stn_name"].astype(str).str.strip()

    # 기상청 일강수 결측 ≈ 강수 없음
    df["precip"] = df["precip"].fillna(0.0)

    num_cols = [
        "temp_avg",
        "temp_min",
        "temp_max",
        "precip",
        "wind_max",
        "wind_avg",
        "humidity_min",
        "humidity_avg",
    ]
    for c in num_cols:
        df[c] = pd.to_numeric(df[c], errors="coerce")

    df = df.sort_values(["stn_id", "date"]).drop_duplicates(["stn_id", "date"], keep="last")
    return df.reset_index(drop=True)


def match_station_to_sigungu(stn_name: str, sig: pd.DataFrame) -> pd.Series | None:
    """지점명 → 대표 시군구 1개 (이름 매칭)."""
    raw = STATION_NAME_OVERRIDE.get(stn_name, stn_name)
    key = strip_admin(raw)

    # 1) 키 완전 일치
    hit = sig[sig["key"] == key]
    if len(hit) == 1:
        return hit.iloc[0]
    if len(hit) > 1:
        # 시 본청 우선 (이름에 구가 없는 쪽) — 없으면 첫 행
        no_gu = hit[~hit["sigungu_name"].str.contains("구", na=False)]
        return (no_gu if len(no_gu) else hit).iloc[0]

    # 2) 시군구명에 키 포함 (창원시의창구 등)
    hit = sig[sig["key"].str.startswith(key) | sig["sigungu_name"].str.contains(key, na=False)]
    if len(hit) >= 1:
        # 키가 더 짧은 매칭보다, key== 또는 startswith 우선
        exactish = hit[hit["key"].str.startswith(key)]
        return (exactish if len(exactish) else hit).iloc[0]

    # 3) 광역시/특별시 명칭 → 해당 province의 임의 구 (중심에 가까운 것)
    metro = {
        "서울": "서울",
        "부산": "부산",
        "대구": "대구",
        "인천": "인천",
        "광주": "광주",
        "대전": "대전",
        "울산": "울산",
        "세종": "세종",
        "제주": "제주",
    }
    if key in metro:
        sub = sig[sig["province"] == metro[key]]
        if len(sub):
            # 라벨 중심(평균)에 가장 가까운 구
            cx, cy = sub["x"].mean(), sub["y"].mean()
            dist = (sub["x"] - cx) ** 2 + (sub["y"] - cy) ** 2
            return sub.loc[dist.idxmin()]

    return None


def build_station_map(asos: pd.DataFrame, sig: pd.DataFrame) -> pd.DataFrame:
    stations = asos[["stn_id", "stn_name"]].drop_duplicates().sort_values("stn_id")
    rows = []
    for _, s in stations.iterrows():
        m = match_station_to_sigungu(s["stn_name"], sig)
        if m is None:
            rows.append(
                {
                    "stn_id": int(s["stn_id"]),
                    "stn_name": s["stn_name"],
                    "sigungu_code": "",
                    "sigungu_name": "",
                    "province": "",
                    "match_method": "unmatched",
                    "x": math.nan,
                    "y": math.nan,
                }
            )
        else:
            rows.append(
                {
                    "stn_id": int(s["stn_id"]),
                    "stn_name": s["stn_name"],
                    "sigungu_code": m["sigungu_code"],
                    "sigungu_name": m["sigungu_name"],
                    "province": m["province"],
                    "match_method": "name",
                    "x": m["x"],
                    "y": m["y"],
                }
            )
    return pd.DataFrame(rows)


def assign_nearest_station(sig: pd.DataFrame, stn_map: pd.DataFrame) -> pd.DataFrame:
    """모든 시군구에 가장 가까운 ASOS 지점 배정."""
    anchors = stn_map.dropna(subset=["x", "y"]).copy()
    anchors = anchors[anchors["sigungu_code"].astype(str).str.len() > 0]
    if anchors.empty:
        raise RuntimeError("매칭된 관측지점이 없습니다.")

    assigned = []
    for _, g in sig.iterrows():
        dx = anchors["x"] - g["x"]
        dy = anchors["y"] - g["y"]
        dist = (dx * dx + dy * dy) ** 0.5
        i = dist.idxmin()
        a = anchors.loc[i]
        assigned.append(
            {
                "sigungu_code": g["sigungu_code"],
                "sigungu_name": g["sigungu_name"],
                "province": g["province"],
                "stn_id": int(a["stn_id"]),
                "stn_name": a["stn_name"],
                "dist_svg": round(float(dist.loc[i]), 3),
                "same_name_station": strip_admin(g["sigungu_name"])
                == strip_admin(STATION_NAME_OVERRIDE.get(a["stn_name"], a["stn_name"])),
            }
        )
    return pd.DataFrame(assigned)


def build_sigungu_daily(asos: pd.DataFrame, sig_stn: pd.DataFrame) -> pd.DataFrame:
    weather_cols = [
        "temp_avg",
        "temp_min",
        "temp_max",
        "precip",
        "wind_max",
        "wind_avg",
        "humidity_min",
        "humidity_avg",
    ]
    base = asos[["stn_id", "date", *weather_cols]].copy()
    merged = sig_stn.merge(base, on="stn_id", how="inner")
    cols = [
        "date",
        "sigungu_code",
        "sigungu_name",
        "province",
        "stn_id",
        "stn_name",
        *weather_cols,
    ]
    out = merged[cols].sort_values(["date", "sigungu_code"]).reset_index(drop=True)
    out["date"] = out["date"].dt.strftime("%Y-%m-%d")
    return out


def main() -> None:
    ensure_dirs()
    if not RAW_ASOS.exists():
        raise FileNotFoundError(RAW_ASOS)

    print("1) ASOS 전처리…")
    asos = preprocess_asos(RAW_ASOS)
    asos_out = asos.copy()
    asos_out["date"] = asos_out["date"].dt.strftime("%Y-%m-%d")
    asos_out.to_csv(OUT_ASOS, index=False, encoding="utf-8-sig")
    print(f"   {OUT_ASOS.name}: {len(asos_out):,}행 / 지점 {asos['stn_id'].nunique()}개")
    print(f"   기간 {asos['date'].min().date()} ~ {asos['date'].max().date()}")

    print("2) 시군구 로드·지점 매핑…")
    sig = load_sigungu()
    stn_map = build_station_map(asos, sig)
    unmatched = stn_map[stn_map["match_method"] == "unmatched"]
    print(f"   지점 이름매칭: {len(stn_map) - len(unmatched)}/{len(stn_map)}")
    if len(unmatched):
        print("   미매칭 지점:", ", ".join(unmatched["stn_name"].astype(str)))

    sig_stn = assign_nearest_station(sig, stn_map)
    # 매핑 저장: 지점 대표 + 시군구별 배정
    stn_map.to_csv(OUT_MAP, index=False, encoding="utf-8-sig")
    sig_stn.to_csv(SIGUNGU_ASOS_STATION, index=False, encoding="utf-8-sig")
    print(f"   {OUT_MAP.name} (지점→대표 시군구)")
    print(f"   {SIGUNGU_ASOS_STATION.name} (시군구→사용 지점) {len(sig_stn)}개")

    print("3) 시군구×일 기상표…")
    daily = build_sigungu_daily(asos, sig_stn)
    daily.to_csv(OUT_SIGUNGU, index=False, encoding="utf-8-sig")
    print(f"   {OUT_SIGUNGU.name}: {len(daily):,}행")
    print(
        f"   시군구 {daily['sigungu_code'].nunique()} × "
        f"일수 {daily['date'].nunique()} "
        f"(기대 약 {sig['sigungu_code'].nunique() * asos['date'].nunique():,})"
    )

    # 임시 파일 정리
    for tmp in [
        DATA_PROCESSED_ETL / "_asos_stations_tmp.json",
        DATA_PROCESSED_ETL / "_sigungu_tmp.json",
    ]:
        if tmp.exists():
            tmp.unlink()

    print("완료.")


if __name__ == "__main__":
    main()
