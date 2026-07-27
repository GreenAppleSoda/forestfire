"""
산불 전처리 데이터(refined_wildfire_data.csv)만으로
지역별 발생 빈도·규모·상대 위험도를 분석합니다.

한계: is_fire=1(발생 건)만 있어 '어느 날 산불이 날 절대 확률'은
추정할 수 없습니다. 대신 (1) 전체 산불 중 지역 비중,
(2) 대형 산불(>=1ha) 조건부 확률, (3) 빈도+규모 위험점수를 제공합니다.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import json

import numpy as np
import pandas as pd
from sklearn.cluster import KMeans
from sklearn.ensemble import GradientBoostingClassifier, RandomForestRegressor
from sklearn.model_selection import cross_val_score
from sklearn.preprocessing import LabelEncoder, StandardScaler

from paths import (
    PROVINCE_RISK,
    REFINED_WILDFIRE,
    WILDFIRE_ML_SUMMARY,
    ensure_dirs,
)

INPUT_CSV = REFINED_WILDFIRE
OUT_CSV = PROVINCE_RISK
OUT_JSON = WILDFIRE_ML_SUMMARY

LARGE_HA = 1.0  # 대형 산불 기준 (ha)
TIER_NAMES = ["고위험", "중고위험", "중위험", "저위험"]


def load_data(path) -> pd.DataFrame:
    df = pd.read_csv(path)
    df["date"] = pd.to_datetime(df["date"])
    df["province"] = df["province"].astype(str).str.strip()
    df["cause"] = df["cause"].fillna("Unknown").astype(str).str.strip()
    df["month"] = df["date"].dt.month
    df["large"] = (df["damage_area"] >= LARGE_HA).astype(int)
    return df


def province_stats(df: pd.DataFrame) -> pd.DataFrame:
    span_years = max((df["date"].max() - df["date"].min()).days / 365.25, 1e-9)
    stats = (
        df.groupby("province", as_index=False)
        .agg(
            fire_count=("damage_area", "size"),
            total_damage_ha=("damage_area", "sum"),
            mean_damage_ha=("damage_area", "mean"),
            median_damage_ha=("damage_area", "median"),
            max_damage_ha=("damage_area", "max"),
            large_fire_rate=("large", "mean"),
        )
    )
    stats["share_pct"] = stats["fire_count"] / stats["fire_count"].sum() * 100
    stats["fires_per_year"] = stats["fire_count"] / span_years
    stats["rel_prob"] = stats["fire_count"] / stats["fire_count"].sum()
    stats["large_fire_pct"] = stats["large_fire_rate"] * 100
    return stats, span_years


def risk_score_and_clusters(stats: pd.DataFrame) -> pd.DataFrame:
    """빈도·중앙 규모·누적 피해·대형 비율을 표준화해 0~100 위험점수 + KMeans 티어."""
    feat = pd.DataFrame(
        {
            "freq": stats["fires_per_year"],
            "median_sev": np.log1p(stats["median_damage_ha"]),
            "total_sev": np.log1p(stats["total_damage_ha"]),
            "large_rate": stats["large_fire_rate"],
        }
    )
    Xs = StandardScaler().fit_transform(feat)
    raw = 0.40 * Xs[:, 0] + 0.15 * Xs[:, 1] + 0.25 * Xs[:, 2] + 0.20 * Xs[:, 3]
    stats = stats.copy()
    stats["risk_score"] = (raw - raw.min()) / (raw.max() - raw.min() + 1e-12) * 100

    k = min(4, len(stats))
    labels = KMeans(n_clusters=k, random_state=42, n_init=10).fit_predict(Xs)
    stats["cluster"] = labels
    # 티어는 위험점수 순위 기준(1등=고위험). 클러스터는 프로파일 유사도용.
    ranks = stats["risk_score"].rank(method="first", ascending=False)
    n = len(stats)
    stats["risk_tier"] = np.minimum(((ranks - 1) * 4 / n).astype(int), 3)
    stats["risk_tier_name"] = stats["risk_tier"].map(lambda i: TIER_NAMES[int(i)])
    return stats


def train_models(df: pd.DataFrame, stats: pd.DataFrame) -> tuple[pd.DataFrame, dict]:
    """
    - 분류: P(대형산불 | 시도, 월, 원인)
    - 회귀: log(피해면적) (참고용, 이상치에 취약)
    """
    work = df.copy()
    le_p, le_c = LabelEncoder(), LabelEncoder()
    work["p"] = le_p.fit_transform(work["province"])
    work["c"] = le_c.fit_transform(work["cause"])
    X = work[["p", "month", "c"]]

    clf = GradientBoostingClassifier(random_state=42)
    auc = cross_val_score(clf, X, work["large"], cv=5, scoring="roc_auc")
    clf.fit(X, work["large"])
    work["p_large"] = clf.predict_proba(X)[:, 1]

    reg = RandomForestRegressor(n_estimators=200, max_depth=8, random_state=42)
    r2 = cross_val_score(reg, X, np.log1p(work["damage_area"]), cv=5, scoring="r2")
    reg.fit(X, np.log1p(work["damage_area"]))

    # 시도별 모델 기반 기대값 (해당 지역 실제 월·원인 분포로 평균)
    ml_rows = []
    for prov in le_p.classes_:
        sub = work[work["province"] == prov]
        ml_rows.append(
            {
                "province": prov,
                "ml_p_large": float(sub["p_large"].mean()),
                "ml_expected_damage_ha": float(np.expm1(reg.predict(sub[["p", "month", "c"]])).mean()),
            }
        )
    ml_df = pd.DataFrame(ml_rows)
    stats = stats.merge(ml_df, on="province", how="left")

    meta = {
        "large_auc_mean": float(auc.mean()),
        "large_auc_std": float(auc.std()),
        "damage_r2_mean": float(r2.mean()),
        "damage_r2_std": float(r2.std()),
        "clf_importance": {
            "province": float(clf.feature_importances_[0]),
            "month": float(clf.feature_importances_[1]),
            "cause": float(clf.feature_importances_[2]),
        },
        "reg_importance": {
            "province": float(reg.feature_importances_[0]),
            "month": float(reg.feature_importances_[1]),
            "cause": float(reg.feature_importances_[2]),
        },
    }
    return stats, meta


def main() -> None:
    ensure_dirs()
    df = load_data(INPUT_CSV)
    stats, span_years = province_stats(df)
    stats = risk_score_and_clusters(stats)
    stats, meta = train_models(df, stats)
    stats = stats.sort_values("risk_score", ascending=False).reset_index(drop=True)

    month_counts = df.groupby("month").size().reindex(range(1, 13), fill_value=0)
    month_share = month_counts / month_counts.sum() * 100

    out_cols = [
        "province",
        "fire_count",
        "share_pct",
        "rel_prob",
        "fires_per_year",
        "median_damage_ha",
        "mean_damage_ha",
        "total_damage_ha",
        "max_damage_ha",
        "large_fire_pct",
        "ml_p_large",
        "ml_expected_damage_ha",
        "risk_score",
        "risk_tier",
        "risk_tier_name",
    ]
    stats[out_cols].to_csv(OUT_CSV, index=False, encoding="utf-8-sig")

    summary = {
        "n_fires": int(len(df)),
        "span_years": float(span_years),
        "date_min": str(df["date"].min().date()),
        "date_max": str(df["date"].max().date()),
        "large_ha_threshold": LARGE_HA,
        "model": meta,
        "provinces": stats[out_cols].round(4).to_dict(orient="records"),
        "month_counts": {str(i): int(month_counts[i]) for i in range(1, 13)},
        "month_share_pct": {str(i): float(round(month_share[i], 2)) for i in range(1, 13)},
        "tier_names": TIER_NAMES,
        "notes": [
            "rel_prob = 전체 산불 건수 대비 해당 시도 비중 (절대 일별 발생확률 아님)",
            "large_fire_pct / ml_p_large = 산불이 난 경우 피해면적 >= 1ha 일 비율·모델확률",
            "risk_score = 빈도·중앙규모·누적피해·대형비율 표준화 가중합 (0~100)",
        ],
    }
    OUT_JSON.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")

    top = stats.head(5)
    print("=== 산불 지역 위험 분석 ===")
    print(f"기간: {summary['date_min']} ~ {summary['date_max']} ({span_years:.2f}년)")
    print(f"총 건수: {len(df)}")
    print(f"대형산불 분류 AUC: {meta['large_auc_mean']:.3f} ± {meta['large_auc_std']:.3f}")
    print("\n위험점수 TOP5")
    print(
        top[
            [
                "province",
                "fire_count",
                "share_pct",
                "fires_per_year",
                "median_damage_ha",
                "large_fire_pct",
                "risk_score",
                "risk_tier_name",
            ]
        ].to_string(index=False)
    )
    print(f"\n저장: {OUT_CSV.name}, {OUT_JSON.name}")


if __name__ == "__main__":
    main()
