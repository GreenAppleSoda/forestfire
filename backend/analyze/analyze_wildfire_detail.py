"""
세부 지역(시군구·읍면·동리) + 시간대 기준 산불 위험·경과 분석.
입력: refined_wildfire_data.csv (preprocess.py 출력)
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import json

import numpy as np
import pandas as pd
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.model_selection import cross_val_score
from sklearn.preprocessing import LabelEncoder, StandardScaler

from paths import (
    CITY_RISK,
    REFINED_WILDFIRE,
    TOWN_RISK,
    WILDFIRE_DETAIL_SUMMARY,
    ensure_dirs,
)

INPUT_CSV = REFINED_WILDFIRE
OUT_CITY = CITY_RISK
OUT_TOWN = TOWN_RISK
OUT_JSON = WILDFIRE_DETAIL_SUMMARY

LARGE_HA = 1.0
TIER_NAMES = ["고위험", "중고위험", "중위험", "저위험"]
MIN_CITY_COUNT = 5  # 시군구 위험점수: 최소 건수
TOP_N = 15


def load_data(path) -> pd.DataFrame:
    df = pd.read_csv(path)
    df["date"] = pd.to_datetime(df["date"])
    df["datetime"] = pd.to_datetime(df["datetime"], errors="coerce")
    for col in ["province", "city", "town", "village", "cause", "time"]:
        if col in df.columns:
            df[col] = df[col].fillna("Unknown").astype(str).str.strip()
    if "hour" not in df.columns or df["hour"].isna().all():
        df["hour"] = df["datetime"].dt.hour
    df["hour"] = df["hour"].fillna(-1).astype(int)
    df["year"] = df["date"].dt.year
    df["month"] = df["date"].dt.month
    df["year_month"] = df["date"].dt.to_period("M").astype(str)
    df["large"] = (df["damage_area"] >= LARGE_HA).astype(int)
    df["city_key"] = df["province"] + " " + df["city"]
    df["town_key"] = df["city_key"] + " " + df["town"]
    return df


def risk_table(df: pd.DataFrame, key_col: str, min_count: int = 1) -> pd.DataFrame:
    span_years = max((df["date"].max() - df["date"].min()).days / 365.25, 1e-9)
    g = (
        df.groupby(key_col, as_index=False)
        .agg(
            fire_count=("damage_area", "size"),
            total_damage_ha=("damage_area", "sum"),
            mean_damage_ha=("damage_area", "mean"),
            median_damage_ha=("damage_area", "median"),
            max_damage_ha=("damage_area", "max"),
            large_fire_rate=("large", "mean"),
            province=("province", "first"),
            peak_hour=("hour", lambda s: int(s[s >= 0].mode().iloc[0]) if (s >= 0).any() else -1),
            peak_month=("month", lambda s: int(s.mode().iloc[0])),
        )
    )
    g = g[g["fire_count"] >= min_count].copy()
    g["share_pct"] = g["fire_count"] / df.shape[0] * 100
    g["fires_per_year"] = g["fire_count"] / span_years
    g["large_fire_pct"] = g["large_fire_rate"] * 100

    feat = pd.DataFrame(
        {
            "freq": g["fires_per_year"],
            "median_sev": np.log1p(g["median_damage_ha"]),
            "total_sev": np.log1p(g["total_damage_ha"]),
            "large_rate": g["large_fire_rate"],
        }
    )
    Xs = StandardScaler().fit_transform(feat)
    raw = 0.40 * Xs[:, 0] + 0.15 * Xs[:, 1] + 0.25 * Xs[:, 2] + 0.20 * Xs[:, 3]
    g["risk_score"] = (raw - raw.min()) / (raw.max() - raw.min() + 1e-12) * 100
    ranks = g["risk_score"].rank(method="first", ascending=False)
    n = len(g)
    g["risk_tier"] = np.minimum(((ranks - 1) * 4 / max(n, 1)).astype(int), 3)
    g["risk_tier_name"] = g["risk_tier"].map(lambda i: TIER_NAMES[int(i)])
    return g.sort_values("risk_score", ascending=False).reset_index(drop=True)


def hourly_stats(df: pd.DataFrame) -> dict:
    valid = df[df["hour"].between(0, 23)]
    by_h = valid.groupby("hour").agg(
        count=("damage_area", "size"),
        mean_damage=("damage_area", "mean"),
        large_rate=("large", "mean"),
    ).reindex(range(24), fill_value=0)
    total = by_h["count"].sum() or 1
    return {
        "counts": [int(by_h.loc[h, "count"]) for h in range(24)],
        "share_pct": [float(by_h.loc[h, "count"] / total * 100) for h in range(24)],
        "large_pct": [float(by_h.loc[h, "large_rate"] * 100) for h in range(24)],
        "mean_damage": [float(by_h.loc[h, "mean_damage"]) if by_h.loc[h, "count"] else 0.0 for h in range(24)],
    }


def monthly_trend(df: pd.DataFrame) -> dict:
    months = (
        df.groupby("year_month")
        .agg(count=("damage_area", "size"), damage=("damage_area", "sum"))
        .sort_index()
    )
    return {
        "labels": months.index.tolist(),
        "counts": [int(x) for x in months["count"]],
        "damage": [float(round(x, 2)) for x in months["damage"]],
    }


def top_region_monthly(df: pd.DataFrame, key_col: str, top_keys: list[str]) -> dict:
    """상위 지역별 월 시계열 (건수). 전체 관측 월 축에 맞춰 0으로 채움."""
    all_months = (
        pd.period_range(df["date"].min(), df["date"].max(), freq="M")
        .astype(str)
        .tolist()
    )
    sub = df[df[key_col].isin(top_keys)]
    pivot = (
        sub.groupby(["year_month", key_col])
        .size()
        .unstack(fill_value=0)
        .reindex(all_months, fill_value=0)
    )
    for k in top_keys:
        if k not in pivot.columns:
            pivot[k] = 0
    pivot = pivot[top_keys]
    return {
        "labels": all_months,
        "series": {k: [int(x) for x in pivot[k].tolist()] for k in top_keys},
    }


def top_region_hourly(df: pd.DataFrame, key_col: str, top_keys: list[str]) -> dict:
    sub = df[(df[key_col].isin(top_keys)) & (df["hour"].between(0, 23))]
    pivot = sub.groupby(["hour", key_col]).size().unstack(fill_value=0).reindex(range(24), fill_value=0)
    for k in top_keys:
        if k not in pivot.columns:
            pivot[k] = 0
    pivot = pivot[top_keys]
    return {
        "hours": list(range(24)),
        "series": {k: [int(x) for x in pivot[k].tolist()] for k in top_keys},
    }


def village_hotspots(df: pd.DataFrame, n: int = 20) -> pd.DataFrame:
    g = (
        df.groupby(["province", "city", "town", "village"], as_index=False)
        .agg(
            fire_count=("damage_area", "size"),
            total_damage_ha=("damage_area", "sum"),
            median_damage_ha=("damage_area", "median"),
            large_fire_pct=("large", "mean"),
            peak_hour=("hour", lambda s: int(s[s >= 0].mode().iloc[0]) if (s >= 0).any() else -1),
        )
    )
    g["large_fire_pct"] *= 100
    g = g[g["village"] != "Unknown"]
    return g.sort_values(["fire_count", "total_damage_ha"], ascending=False).head(n)


def train_detail_model(df: pd.DataFrame) -> dict:
    work = df[df["hour"].between(0, 23)].copy()
    encoders = {}
    for col in ["province", "city", "town", "cause"]:
        le = LabelEncoder()
        work[f"e_{col}"] = le.fit_transform(work[col])
        encoders[col] = le
    X = work[["e_province", "e_city", "e_town", "month", "hour", "e_cause"]]
    y = work["large"]
    clf = GradientBoostingClassifier(random_state=42)
    auc = cross_val_score(clf, X, y, cv=5, scoring="roc_auc")
    clf.fit(X, y)
    names = ["province", "city", "town", "month", "hour", "cause"]
    return {
        "large_auc_mean": float(auc.mean()),
        "large_auc_std": float(auc.std()),
        "importance": {n: float(v) for n, v in zip(names, clf.feature_importances_)},
    }


def main() -> None:
    ensure_dirs()
    df = load_data(INPUT_CSV)
    span_years = (df["date"].max() - df["date"].min()).days / 365.25

    city = risk_table(df, "city_key", min_count=MIN_CITY_COUNT)
    town = risk_table(df[df["town"] != "Unknown"], "town_key", min_count=3)

    city.to_csv(OUT_CITY, index=False, encoding="utf-8-sig")
    town.to_csv(OUT_TOWN, index=False, encoding="utf-8-sig")

    top_cities = city.head(TOP_N)["city_key"].tolist()
    top5 = city.head(5)["city_key"].tolist()
    villages = village_hotspots(df, n=20)
    model = train_detail_model(df)
    hour = hourly_stats(df)
    month = monthly_trend(df)
    city_month = top_region_monthly(df, "city_key", top5)
    city_hour = top_region_hourly(df, "city_key", top5)

    # 시도별 시군구 분포 (상위)
    province_top = (
        df.groupby(["province", "city"])
        .size()
        .reset_index(name="count")
        .sort_values("count", ascending=False)
    )

    summary = {
        "n_fires": int(len(df)),
        "span_years": float(span_years),
        "date_min": str(df["date"].min().date()),
        "date_max": str(df["date"].max().date()),
        "n_cities": int(df["city"].nunique()),
        "n_towns": int(df.loc[df["town"] != "Unknown", "town"].nunique()),
        "n_villages": int(df.loc[df["village"] != "Unknown", "village"].nunique()),
        "large_ha_threshold": LARGE_HA,
        "model": model,
        "hourly": hour,
        "monthly": month,
        "top_cities": city.head(TOP_N).round(4).to_dict(orient="records"),
        "top_towns": town.head(TOP_N).round(4).to_dict(orient="records"),
        "top_villages": villages.round(4).to_dict(orient="records"),
        "top5_city_monthly": city_month,
        "top5_city_hourly": city_hour,
        "peak_hour_overall": int(np.argmax(hour["counts"])),
        "peak_month_overall": int(df["month"].mode().iloc[0]),
        "notes": [
            "city_key = 시도+시군구, town_key = 시도+시군구+읍면",
            "시간 경과: year_month 시계열 + 시간대(0-23시) 분포",
            "대형 산불 = 피해면적 >= 1ha",
        ],
    }
    OUT_JSON.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")

    print("=== 세부 지역·시간 산불 분석 ===")
    print(f"기간: {summary['date_min']} ~ {summary['date_max']}")
    print(f"시군구 {summary['n_cities']} / 읍면 {summary['n_towns']} / 동리 {summary['n_villages']}")
    print(f"전체 피크 시간: {summary['peak_hour_overall']}시 | 피크 월: {summary['peak_month_overall']}월")
    print(f"대형분류 AUC: {model['large_auc_mean']:.3f}")
    print("\n시군구 위험 TOP10")
    print(
        city.head(10)[
            ["city_key", "fire_count", "share_pct", "large_fire_pct", "peak_hour", "risk_score"]
        ].to_string(index=False)
    )
    print(f"\n저장: {OUT_CITY.name}, {OUT_TOWN.name}, {OUT_JSON.name}")


if __name__ == "__main__":
    main()
