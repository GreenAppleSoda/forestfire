"""
시군구×일 산불 발생 예측 — XGBoost

1) weather_daily_sigungu + refined_wildfire → 학습 테이블 (y=당일 산불 여부)
2) 시간 분할 검증 (train: ~2024-12-31 / test: 2025-01-01~)
3) 시군구별 ML 위험점수 저장

출력:
  db/processed/ml_train_sigungu_daily.parquet (또는 csv 샘플)
  db/output/wildfire_xgb_metrics.json
  db/output/sigungu_ml_risk_scores.csv
  db/output/wildfire_xgb_feature_importance.csv
  frontend/public/data/sigungu_ml_scores.json  (지도 연동용)
"""

from __future__ import annotations

import json
import re
from collections import defaultdict
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.metrics import (
    average_precision_score,
    roc_auc_score,
    precision_recall_fscore_support,
)
from xgboost import XGBClassifier

from paths import (
    ADMIN_SIGUNGU_JSON,
    DATA_OUTPUT,
    DATA_PROCESSED,
    REFINED_WILDFIRE,
    ROOT,
    SIGUNGU_HIST_STATE,
    SIGUNGU_ML_SCORES_WEB,
    WEATHER_DAILY_SIGUNGU,
    WEATHER_RECENT_TAIL,
    WILDFIRE_XGB_BUNDLE,
    WILDFIRE_XGB_MODEL,
    ensure_dirs,
)

ADMIN_SIGUNGU = ADMIN_SIGUNGU_JSON
OUT_METRICS = DATA_OUTPUT / "wildfire_xgb_metrics.json"
OUT_SCORES = DATA_OUTPUT / "sigungu_ml_risk_scores.csv"
OUT_IMP = DATA_OUTPUT / "wildfire_xgb_feature_importance.csv"
OUT_WEB = SIGUNGU_ML_SCORES_WEB
OUT_TRAIN_SAMPLE = DATA_PROCESSED / "ml_train_sigungu_daily_sample.csv"

TEST_START = "2025-01-01"
FEATURE_COLS = [
    "temp_avg",
    "temp_min",
    "temp_max",
    "precip",
    "precip_3d",
    "precip_7d",
    "wind_avg",
    "wind_max",
    "humidity_avg",
    "humidity_min",
    "dry_spell",
    "month",
    "month_sin",
    "month_cos",
    "dow",
    "hist_fire_rate",
    "hist_fire_count_365",
]


def strip_admin(name: str) -> str:
    name = re.sub(r"\s+", "", str(name).strip())
    name = re.sub(r"(특별자치시|광역시|특별시|특별자치도)$", "", name)
    name = re.sub(r"(시|군|구|읍|면|동|리)$", "", name)
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
                "key": strip_admin(r["name"]),
            }
        )
    return pd.DataFrame(rows)


def match_fire_to_codes(fires: pd.DataFrame, sig: pd.DataFrame) -> pd.DataFrame:
    """산불 행 → sigungu_code (시군구·일 단위 라벨)."""
    by_prov_key: dict[str, list[str]] = defaultdict(list)
    by_prov: dict[str, list[str]] = defaultdict(list)
    name_by_code = {}
    key_by_code = {}
    for _, r in sig.iterrows():
        by_prov_key[f"{r['province']}|{r['key']}"].append(r["sigungu_code"])
        by_prov[r["province"]].append(r["sigungu_code"])
        name_by_code[r["sigungu_code"]] = r["sigungu_name"]
        key_by_code[r["sigungu_code"]] = r["key"]

    rows = []
    for _, f in fires.iterrows():
        prov = str(f["province"]).strip()
        city = str(f["city"]).strip()
        if city in ("", "Unknown", "nan"):
            continue
        key = strip_admin(city)
        codes = list(by_prov_key.get(f"{prov}|{key}", []))

        if not codes:
            raw = re.sub(r"\s+", "", city)
            m = re.match(r"^(.+?시)(.+구)$", raw)
            if m:
                gu = strip_admin(m.group(2))
                codes = list(by_prov_key.get(f"{prov}|{gu}", []))
                if not codes:
                    city_n = strip_admin(m.group(1))
                    codes = [
                        c
                        for c in by_prov.get(prov, [])
                        if key_by_code[c].startswith(city_n)
                    ]

        if not codes:
            codes = [
                c
                for c in by_prov.get(prov, [])
                if key_by_code[c].startswith(key) or key in name_by_code[c]
            ]

        metro_alias = {
            "서울": "서울",
            "부산": "부산",
            "대구": "대구",
            "인천": "인천",
            "광주": "광주",
            "대전": "대전",
            "울산": "울산",
            "세종": "세종",
        }
        if not codes and key in metro_alias:
            codes = list(by_prov.get(metro_alias[key], []))

        date = pd.Timestamp(f["date"]).strftime("%Y-%m-%d")
        # 광역시 전체 매칭이면 과도한 양성 → 대표 1개만 (첫 코드)
        if len(codes) > 5 and key in metro_alias:
            codes = codes[:1]
        for code in codes:
            rows.append({"date": date, "sigungu_code": code, "y": 1})

    if not rows:
        return pd.DataFrame(columns=["date", "sigungu_code", "y"])
    return pd.DataFrame(rows).drop_duplicates(["date", "sigungu_code"])


def add_weather_features(w: pd.DataFrame) -> pd.DataFrame:
    w = w.sort_values(["sigungu_code", "date"]).copy()
    w["date"] = pd.to_datetime(w["date"])
    g = w.groupby("sigungu_code", group_keys=False)

    w["precip_3d"] = g["precip"].transform(lambda s: s.rolling(3, min_periods=1).sum())
    w["precip_7d"] = g["precip"].transform(lambda s: s.rolling(7, min_periods=1).sum())

    def dry_spell(s: pd.Series) -> pd.Series:
        out = []
        n = 0
        for v in s.fillna(0):
            if v <= 0:
                n += 1
            else:
                n = 0
            out.append(n)
        return pd.Series(out, index=s.index)

    w["dry_spell"] = g["precip"].transform(dry_spell)

    w["month"] = w["date"].dt.month
    w["dow"] = w["date"].dt.dayofweek
    w["month_sin"] = np.sin(2 * np.pi * w["month"] / 12)
    w["month_cos"] = np.cos(2 * np.pi * w["month"] / 12)
    return w


def add_history_features(df: pd.DataFrame, fire_labels: pd.DataFrame) -> pd.DataFrame:
    """과거 365일 발생 건수·비율 (누수 방지: 당일 제외)."""
    df = df.copy()
    df["sigungu_code"] = df["sigungu_code"].astype(str)
    fire_labels = fire_labels.copy()
    fire_labels["sigungu_code"] = fire_labels["sigungu_code"].astype(str)
    fire_labels["date"] = fire_labels["date"].astype(str)

    fire_set = set(zip(fire_labels["date"], fire_labels["sigungu_code"]))
    df = df.sort_values(["sigungu_code", "date"])
    df["date_str"] = pd.to_datetime(df["date"]).dt.strftime("%Y-%m-%d")
    df["y"] = [
        1 if (d, c) in fire_set else 0
        for d, c in zip(df["date_str"], df["sigungu_code"])
    ]

    count_parts = []
    rate_parts = []
    for _, grp in df.groupby("sigungu_code", sort=False):
        ys = pd.Series(grp["y"].to_numpy(), index=grp.index)
        past = ys.shift(1).fillna(0)
        c365 = past.rolling(365, min_periods=1).sum()
        n365 = past.rolling(365, min_periods=1).count()
        count_parts.append(c365)
        rate_parts.append(c365 / n365.replace(0, np.nan))

    df["hist_fire_count_365"] = pd.concat(count_parts).sort_index()
    df["hist_fire_rate"] = pd.concat(rate_parts).sort_index().fillna(0)
    return df


def train_and_eval(df: pd.DataFrame) -> tuple[XGBClassifier, dict, pd.DataFrame]:
    df = df.dropna(subset=FEATURE_COLS).copy()
    df["date_str"] = df["date"].dt.strftime("%Y-%m-%d")

    train = df[df["date_str"] < TEST_START]
    test = df[df["date_str"] >= TEST_START]
    if train.empty or test.empty:
        raise RuntimeError("train/test 분할 결과가 비어 있습니다.")

    X_train, y_train = train[FEATURE_COLS], train["y"].astype(int)
    X_test, y_test = test[FEATURE_COLS], test["y"].astype(int)

    pos = int(y_train.sum())
    neg = int(len(y_train) - pos)
    spw = max(neg / max(pos, 1), 1.0)

    model = XGBClassifier(
        n_estimators=300,
        max_depth=5,
        learning_rate=0.05,
        subsample=0.8,
        colsample_bytree=0.8,
        min_child_weight=5,
        reg_lambda=1.0,
        objective="binary:logistic",
        eval_metric="auc",
        scale_pos_weight=spw,
        random_state=42,
        n_jobs=4,
    )
    model.fit(X_train, y_train)

    proba = model.predict_proba(X_test)[:, 1]
    # 불균형 → 상위 비율로 threshold (test 양성 비율의 ~10배 또는 0.5)
    thr = float(np.quantile(proba, 1 - min(0.05, max(y_test.mean() * 10, 0.01))))
    pred = (proba >= thr).astype(int)

    precision, recall, f1, _ = precision_recall_fscore_support(
        y_test, pred, average="binary", zero_division=0
    )
    metrics = {
        "test_start": TEST_START,
        "n_train": int(len(train)),
        "n_test": int(len(test)),
        "n_train_pos": pos,
        "n_test_pos": int(y_test.sum()),
        "scale_pos_weight": round(spw, 2),
        "threshold": round(thr, 4),
        "roc_auc": round(float(roc_auc_score(y_test, proba)), 4),
        "pr_auc": round(float(average_precision_score(y_test, proba)), 4),
        "precision": round(float(precision), 4),
        "recall": round(float(recall), 4),
        "f1": round(float(f1), 4),
        "features": FEATURE_COLS,
    }

    test_out = test[
        ["date_str", "sigungu_code", "sigungu_name", "province", "y"]
    ].copy()
    test_out["y_prob"] = proba
    return model, metrics, test_out


def region_scores(test_out: pd.DataFrame, full_df: pd.DataFrame, model: XGBClassifier) -> pd.DataFrame:
    """시군구별 위험점수: test 기간 평균 예측확률 + 봄철(2~5월) 평균."""
    # 전체 기간 예측(학습 누수 줄이려 test만 기본 사용) + 참고로 전체 재예측
    X_all = full_df[FEATURE_COLS]
    full_df = full_df.copy()
    full_df["y_prob"] = model.predict_proba(X_all)[:, 1]
    full_df["month"] = full_df["date"].dt.month

    test_start = pd.Timestamp(TEST_START)
    test_part = full_df[full_df["date"] >= test_start]
    spring = full_df[full_df["month"].isin([2, 3, 4, 5])]

    def agg(part: pd.DataFrame, prefix: str) -> pd.DataFrame:
        g = (
            part.groupby(["sigungu_code", "sigungu_name", "province"], as_index=False)
            .agg(
                **{
                    f"{prefix}_mean_prob": ("y_prob", "mean"),
                    f"{prefix}_max_prob": ("y_prob", "max"),
                    f"{prefix}_fire_days": ("y", "sum"),
                }
            )
        )
        return g

    base = agg(test_part, "test")
    spr = agg(spring, "spring")
    out = base.merge(spr, on=["sigungu_code", "sigungu_name", "province"], how="left")

    # 지도용 점수: test 평균 확률을 0~1로 (이미 확률)
    out["ml_risk"] = out["test_mean_prob"].clip(0, 1)
    out["ml_risk_norm"] = (
        (out["ml_risk"] - out["ml_risk"].min())
        / (out["ml_risk"].max() - out["ml_risk"].min() + 1e-12)
    )
    return out.sort_values("ml_risk", ascending=False).reset_index(drop=True)


def main() -> None:
    ensure_dirs()
    print("1) 데이터 로드…")
    weather = pd.read_csv(WEATHER_DAILY_SIGUNGU, encoding="utf-8-sig")
    fires = pd.read_csv(REFINED_WILDFIRE)
    fires["date"] = pd.to_datetime(fires["date"], errors="coerce")
    fires = fires.dropna(subset=["date"])
    sig = load_sigungu()

    print("2) 산불 → 시군구 매칭…")
    fire_labels = match_fire_to_codes(fires, sig)
    print(f"   산불 원본 {len(fires)}건 → 라벨 {len(fire_labels)} (시군구·일)")

    print("3) 기상 파생변수…")
    weather = weather.copy()
    weather["sigungu_code"] = weather["sigungu_code"].astype(str)
    w = add_weather_features(weather)

    print("4) 이력 feature + y…")
    df = add_history_features(w, fire_labels)
    print(f"   학습 후보 행 {len(df):,} / 양성 {int(df['y'].sum()):,} ({df['y'].mean()*100:.3f}%)")

    # 샘플 저장 (전체 parquet는 용량 큼 → 양성+랜덤음성 샘플 CSV)
    pos = df[df["y"] == 1]
    neg = df[df["y"] == 0].sample(n=min(5000, (df["y"] == 0).sum()), random_state=42)
    sample = pd.concat([pos, neg]).sort_values(["date", "sigungu_code"])
    sample_out = sample[
        ["date_str", "sigungu_code", "sigungu_name", "province", "y", *FEATURE_COLS]
    ].copy()
    sample_out.to_csv(OUT_TRAIN_SAMPLE, index=False, encoding="utf-8-sig")
    print(f"   샘플 저장: {OUT_TRAIN_SAMPLE.name} ({len(sample_out):,}행)")

    print("5) XGBoost 학습…")
    model, metrics, test_out = train_and_eval(df)
    print(
        f"   ROC-AUC={metrics['roc_auc']}  PR-AUC={metrics['pr_auc']}  "
        f"P={metrics['precision']} R={metrics['recall']} F1={metrics['f1']}"
    )

    imp = (
        pd.DataFrame({"feature": FEATURE_COLS, "importance": model.feature_importances_})
        .sort_values("importance", ascending=False)
    )
    imp.to_csv(OUT_IMP, index=False, encoding="utf-8-sig")
    metrics["top_features"] = imp.head(8).to_dict(orient="records")

    print("6) 시군구 위험점수…")
    scores = region_scores(test_out, df, model)
    scores.to_csv(OUT_SCORES, index=False, encoding="utf-8-sig")

    web_payload = {
        "model": "xgboost_sigungu_daily",
        "test_start": TEST_START,
        "metrics": {
            "roc_auc": metrics["roc_auc"],
            "pr_auc": metrics["pr_auc"],
            "precision": metrics["precision"],
            "recall": metrics["recall"],
            "f1": metrics["f1"],
        },
        "note": "ml_risk = 2025년 test 기간 일별 예측확률 평균 (시군구)",
        "regions": [
            {
                "code": r["sigungu_code"],
                "name": r["sigungu_name"],
                "province": r["province"],
                "ml_risk": round(float(r["ml_risk"]), 6),
                "ml_risk_norm": round(float(r["ml_risk_norm"]), 4),
                "test_fire_days": int(r["test_fire_days"]),
            }
            for _, r in scores.iterrows()
        ],
    }
    OUT_WEB.write_text(json.dumps(web_payload, ensure_ascii=False), encoding="utf-8")
    OUT_METRICS.write_text(json.dumps(metrics, ensure_ascii=False, indent=2), encoding="utf-8")

    print("7) 모델·추론용 상태 저장…")
    # XGBoost 네이티브 JSON (joblib 불필요)
    model.save_model(str(WILDFIRE_XGB_MODEL))

    # 시군구별 최신 이력 feature (당일 예측 시 사용)
    last = (
        df.sort_values("date")
        .groupby("sigungu_code", as_index=False)
        .tail(1)[
            [
                "sigungu_code",
                "sigungu_name",
                "province",
                "hist_fire_rate",
                "hist_fire_count_365",
                "date_str",
            ]
        ]
    )
    last.to_csv(SIGUNGU_HIST_STATE, index=False, encoding="utf-8-sig")

    # 최근 14일 기상 (precip_3d/7d·dry_spell 계산용)
    max_d = df["date"].max()
    tail = df[df["date"] >= max_d - pd.Timedelta(days=13)][
        [
            "date",
            "sigungu_code",
            "sigungu_name",
            "province",
            "temp_avg",
            "temp_min",
            "temp_max",
            "precip",
            "wind_max",
            "wind_avg",
            "humidity_min",
            "humidity_avg",
        ]
    ].copy()
    tail["date"] = pd.to_datetime(tail["date"]).dt.strftime("%Y-%m-%d")
    tail.to_csv(WEATHER_RECENT_TAIL, index=False, encoding="utf-8-sig")

    bundle = {
        "model_path": str(WILDFIRE_XGB_MODEL.relative_to(ROOT)).replace("\\", "/"),
        "features": FEATURE_COLS,
        "test_start": TEST_START,
        "trained_at": pd.Timestamp.now().isoformat(timespec="seconds"),
        "metrics": {
            "roc_auc": metrics["roc_auc"],
            "pr_auc": metrics["pr_auc"],
            "threshold": metrics["threshold"],
        },
        "hist_state": str(SIGUNGU_HIST_STATE.relative_to(ROOT)).replace("\\", "/"),
        "weather_tail": str(WEATHER_RECENT_TAIL.relative_to(ROOT)).replace("\\", "/"),
        "note": "predict_daily_risk.py 로 날짜·날씨 입력 예측",
    }
    WILDFIRE_XGB_BUNDLE.write_text(
        json.dumps(bundle, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"   {WILDFIRE_XGB_MODEL.name}")
    print(f"   {SIGUNGU_HIST_STATE.name} / {WEATHER_RECENT_TAIL.name}")
    print(f"   {WILDFIRE_XGB_BUNDLE.name}")

    print(f"   {OUT_SCORES.name}")
    print(f"   {OUT_WEB.name}")
    print(f"   {OUT_METRICS.name}")
    print("상위 10개 시군구:")
    print(
        scores.head(10)[
            ["sigungu_name", "province", "ml_risk", "test_fire_days"]
        ].to_string(index=False)
    )
    print("완료.")


if __name__ == "__main__":
    main()
