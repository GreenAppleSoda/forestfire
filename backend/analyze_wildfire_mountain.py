"""
산 정보(mountain_location.csv) + 산불 세부 분석(refined_wildfire_data.csv)을
시군구·읍면 단위로 조인해 산 밀도·고도 vs 산불 위험 인사이트를 만듭니다.
"""

from __future__ import annotations

import json

import numpy as np
import pandas as pd
from sklearn.ensemble import GradientBoostingRegressor
from sklearn.model_selection import cross_val_score
from sklearn.preprocessing import StandardScaler

from paths import (
    CITY_RISK,
    MOUNTAIN_LOCATION,
    REFINED_WILDFIRE,
    WILDFIRE_MOUNTAIN_CITY,
    WILDFIRE_MOUNTAIN_SUMMARY,
    WILDFIRE_MOUNTAIN_TOWN,
    ensure_dirs,
)

FIRE_CSV = REFINED_WILDFIRE
MOUNTAIN_LOC = MOUNTAIN_LOCATION
OUT_CITY = WILDFIRE_MOUNTAIN_CITY
OUT_TOWN = WILDFIRE_MOUNTAIN_TOWN
OUT_JSON = WILDFIRE_MOUNTAIN_SUMMARY

LARGE_HA = 1.0


def load_fire() -> pd.DataFrame:
    df = pd.read_csv(FIRE_CSV)
    df["date"] = pd.to_datetime(df["date"])
    for c in ["province", "city", "town", "village"]:
        df[c] = df[c].fillna("Unknown").astype(str).str.strip()
    df["hour"] = pd.to_numeric(df.get("hour"), errors="coerce").fillna(-1).astype(int)
    df["month"] = df["date"].dt.month
    df["large"] = (df["damage_area"] >= LARGE_HA).astype(int)
    df["city_key"] = df["province"] + " " + df["city"]
    df["town_key"] = df["city_key"] + " " + df["town"]
    return df


def load_mountains() -> pd.DataFrame:
    if not MOUNTAIN_LOC.exists():
        raise FileNotFoundError(
            f"{MOUNTAIN_LOC.name} 없음. 먼저 python get_mountain_data.py 실행하세요."
        )
    m = pd.read_csv(MOUNTAIN_LOC)
    m["mntn_hght"] = pd.to_numeric(m["mntn_hght"], errors="coerce")
    for c in ["province", "city", "town", "city_key", "town_key", "mntn_nm"]:
        if c in m.columns:
            m[c] = m[c].fillna("Unknown").astype(str).str.strip()
    m = m[m["province"] != "Unknown"].copy()
    return m


def mountain_agg(m: pd.DataFrame, key: str) -> pd.DataFrame:
    g = (
        m.groupby(key, as_index=False)
        .agg(
            mountain_count=("mntn_id", "nunique"),
            mountain_mentions=("mntn_id", "size"),
            max_height_m=("mntn_hght", "max"),
            mean_height_m=("mntn_hght", "mean"),
            high_mountain_count=("mntn_hght", lambda s: int((s.fillna(0) >= 1000).sum())),
            mountain_names=("mntn_nm", lambda s: ", ".join(sorted(set(s.dropna().astype(str)))[:8])),
        )
    )
    return g


def fire_agg(df: pd.DataFrame, key: str) -> pd.DataFrame:
    span = max((df["date"].max() - df["date"].min()).days / 365.25, 1e-9)
    g = (
        df.groupby(key, as_index=False)
        .agg(
            fire_count=("damage_area", "size"),
            total_damage_ha=("damage_area", "sum"),
            median_damage_ha=("damage_area", "median"),
            large_fire_pct=("large", "mean"),
            peak_hour=("hour", lambda s: int(s[s >= 0].mode().iloc[0]) if (s >= 0).any() else -1),
            peak_month=("month", lambda s: int(s.mode().iloc[0])),
            province=("province", "first"),
        )
    )
    g["large_fire_pct"] *= 100
    g["fires_per_year"] = g["fire_count"] / span
    return g


def add_risk(merged: pd.DataFrame) -> pd.DataFrame:
    out = merged.copy()
    out["mountain_count"] = out["mountain_count"].fillna(0)
    out["max_height_m"] = out["max_height_m"].fillna(0)
    out["mean_height_m"] = out["mean_height_m"].fillna(0)
    out["high_mountain_count"] = out["high_mountain_count"].fillna(0)
    out["has_mountain"] = (out["mountain_count"] > 0).astype(int)

    # 산불 위험(기존과 유사) + 산 밀도 보정 인사이트용 점수
    feat = pd.DataFrame(
        {
            "freq": out["fires_per_year"].fillna(0),
            "sev": np.log1p(out["total_damage_ha"].fillna(0)),
            "large": out["large_fire_pct"].fillna(0) / 100,
            "mnt": np.log1p(out["mountain_count"]),
            "hgt": np.log1p(out["max_height_m"]),
        }
    )
    Xs = StandardScaler().fit_transform(feat)
    raw = 0.35 * Xs[:, 0] + 0.25 * Xs[:, 1] + 0.15 * Xs[:, 2] + 0.15 * Xs[:, 3] + 0.10 * Xs[:, 4]
    out["combined_risk"] = (raw - raw.min()) / (raw.max() - raw.min() + 1e-12) * 100

    # 산 대비 산불 강도: 산이 있는 지역에서 산불/산 비율
    out["fires_per_mountain"] = np.where(
        out["mountain_count"] > 0,
        out["fire_count"] / out["mountain_count"],
        np.nan,
    )
    return out


def merge_level(fire: pd.DataFrame, mtn: pd.DataFrame, key: str, min_fire: int) -> pd.DataFrame:
    f = fire_agg(fire, key)
    m = mountain_agg(mtn, key)
    merged = f.merge(m, on=key, how="left")
    merged = add_risk(merged)
    # 기존 city risk 점수 있으면 붙이기
    if key == "city_key" and CITY_RISK.exists():
        cr = pd.read_csv(CITY_RISK)[["city_key", "risk_score", "risk_tier_name"]]
        merged = merged.merge(cr, on="city_key", how="left")
    return merged[merged["fire_count"] >= min_fire].sort_values("combined_risk", ascending=False)


def correlation_block(city: pd.DataFrame) -> dict:
    cols = ["fire_count", "total_damage_ha", "large_fire_pct", "mountain_count", "max_height_m", "combined_risk"]
    sub = city[cols].fillna(0)
    corr = sub.corr(method="spearman").round(3)
    return {
        "fire_vs_mountain_count": float(corr.loc["fire_count", "mountain_count"]),
        "damage_vs_max_height": float(corr.loc["total_damage_ha", "max_height_m"]),
        "large_vs_mountain_count": float(corr.loc["large_fire_pct", "mountain_count"]),
        "combined_vs_mountain_count": float(corr.loc["combined_risk", "mountain_count"]),
    }


def ml_importance(city: pd.DataFrame) -> dict:
    """산불 건수를 산 특성·대형비율 등으로 설명 (참고용)."""
    work = city[city["fire_count"] >= 5].copy()
    if len(work) < 20:
        return {"note": "표본 부족"}
    X = work[["mountain_count", "max_height_m", "mean_height_m", "high_mountain_count", "large_fire_pct"]].fillna(0)
    y = np.log1p(work["fire_count"])
    model = GradientBoostingRegressor(random_state=42)
    r2 = cross_val_score(model, X, y, cv=5, scoring="r2")
    model.fit(X, y)
    return {
        "r2_mean": float(r2.mean()),
        "r2_std": float(r2.std()),
        "importance": {
            n: float(v)
            for n, v in zip(
                ["mountain_count", "max_height_m", "mean_height_m", "high_mountain_count", "large_fire_pct"],
                model.feature_importances_,
            )
        },
    }


def main() -> None:
    ensure_dirs()
    fire = load_fire()
    mtn = load_mountains()

    city = merge_level(fire, mtn, "city_key", min_fire=3)
    town = merge_level(fire, mtn, "town_key", min_fire=2)
    town = town[town["town_key"].str.contains("Unknown") == False]  # noqa: E712

    city.to_csv(OUT_CITY, index=False, encoding="utf-8-sig")
    town.to_csv(OUT_TOWN, index=False, encoding="utf-8-sig")

    with_m = city[city["has_mountain"] == 1]
    without_m = city[city["has_mountain"] == 0]

    # 산은 많은데 산불도 많은 / 산은 있는데 산불 적은 지역
    high_both = (
        city[(city["mountain_count"] >= city["mountain_count"].median()) & (city["fire_count"] >= city["fire_count"].median())]
        .sort_values("combined_risk", ascending=False)
        .head(12)
    )
    mountain_hot = with_m.sort_values("fires_per_mountain", ascending=False).head(12)
    tall_risky = with_m.sort_values(["max_height_m", "fire_count"], ascending=False).head(12)

    corr = correlation_block(city)
    ml = ml_importance(city)

    summary = {
        "n_fires": int(len(fire)),
        "n_mountains": int(mtn["mntn_id"].nunique()),
        "n_mountain_locations": int(len(mtn)),
        "cities_with_fire": int(city.shape[0]),
        "cities_with_mountain_and_fire": int(with_m.shape[0]),
        "cities_fire_no_mountain_match": int(without_m.shape[0]),
        "avg_fire_count_with_mountain": float(with_m["fire_count"].mean()) if len(with_m) else 0,
        "avg_fire_count_without_mountain": float(without_m["fire_count"].mean()) if len(without_m) else 0,
        "avg_large_pct_with_mountain": float(with_m["large_fire_pct"].mean()) if len(with_m) else 0,
        "avg_large_pct_without_mountain": float(without_m["large_fire_pct"].mean()) if len(without_m) else 0,
        "correlation": corr,
        "model": ml,
        "top_combined": city.head(15).round(4).to_dict(orient="records"),
        "high_mountain_and_fire": high_both.round(4).to_dict(orient="records"),
        "fires_per_mountain_top": mountain_hot.round(4).to_dict(orient="records"),
        "tall_mountain_fire_areas": tall_risky.round(4).to_dict(orient="records"),
        "top_towns": town.head(12).round(4).to_dict(orient="records"),
        "notes": [
            "산 소재지(mntninfopoflc)를 시도·시군구·읍면으로 파싱해 city_key/town_key로 산불 데이터와 조인",
            "한 산이 여러 시군에 걸치면 각 지역에 모두 카운트(펼침)",
            "매칭 실패(Unknown/이름 불일치) 지역은 mountain_count=0으로 남을 수 있음",
        ],
    }
    OUT_JSON.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")

    print("=== 산불 × 산 정보 조인 분석 ===")
    print(f"산 {summary['n_mountains']}개 / 산불 {summary['n_fires']}건")
    print(f"산 매칭된 시군구: {summary['cities_with_mountain_and_fire']} / 산불 시군구 {summary['cities_with_fire']}")
    print(f"산 있는 시군 평균 산불건수: {summary['avg_fire_count_with_mountain']:.1f}")
    print(f"산 매칭 없는 시군 평균 산불건수: {summary['avg_fire_count_without_mountain']:.1f}")
    print("상관(Spearman) fire vs mountain_count:", corr["fire_vs_mountain_count"])
    print("\n종합위험 TOP8")
    cols = ["city_key", "fire_count", "mountain_count", "max_height_m", "large_fire_pct", "combined_risk"]
    print(city.head(8)[cols].to_string(index=False))
    print(f"\n저장: {OUT_CITY.name}, {OUT_TOWN.name}, {OUT_JSON.name}")


if __name__ == "__main__":
    main()
