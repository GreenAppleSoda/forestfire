"""
시군구×일 산불 발생 예측 — XGBoost

1) MariaDB weather_daily_sigungu + MariaDB forestfire_stats → 학습 테이블 (y=당일 산불 여부)
   (DB 실패 시에만 로컬 CSV 폴백)
2) 시간 분할 검증 (train: ~2024-12-31 / test: 2025-01-01~)
3) 시군구별 ML 위험점수 저장

출력:
  db-archive/processed/ml_train_sigungu_daily_1y.csv  (학습 직전, 최근 365일 전체)
  db-archive/processed/ml_train_sigungu_daily_sample.csv
  db-archive/output/wildfire_xgb_metrics.json
  db-archive/output/sigungu_ml_risk_scores.csv
  db-archive/output/wildfire_xgb_feature_importance.csv
  db/output/wildfire_xgb_model.json · wildfire_xgb_bundle.json
  db/processed/sigungu_hist_state.csv  (시군구 이력 feature, 예측용)
  frontend/public/data/sigungu_ml_scores.json  (지도 연동용)

feature: 사용자 입력 기상 4개 + 시군구 산불이력 2개 + DWI + 강수파생 3개

예측 엔진(DWI·강수파생 포함)은 ml-service/predict/ 에 두고, 학습은 여기서 import 한다.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # etl/
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "ml-service"))

import json
import re
from collections import defaultdict
from typing import Any

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
    DATA_PROCESSED_ETL,
    ML_TRAIN_SIGUNGU_DAILY_1Y,
    ROOT,
    SIGUNGU_HIST_STATE,
    SIGUNGU_ML_SCORES_WEB,
    WEATHER_DAILY_SIGUNGU,
    WILDFIRE_XGB_BUNDLE,
    WILDFIRE_XGB_CALIBRATOR,
    WILDFIRE_XGB_IMPORTANCE,
    WILDFIRE_XGB_METRICS,
    WILDFIRE_XGB_MODEL,
    SIGUNGU_ML_RISK_SCORES,
    ensure_dirs,
)
from predict.calibration import apply_calibration, save_calibrator
from predict.dwi import add_dwi_column
from predict.precip_features import add_precip_feature_columns

ADMIN_SIGUNGU = ADMIN_SIGUNGU_JSON
OUT_METRICS = WILDFIRE_XGB_METRICS
OUT_SCORES = SIGUNGU_ML_RISK_SCORES
OUT_IMP = WILDFIRE_XGB_IMPORTANCE
OUT_WEB = SIGUNGU_ML_SCORES_WEB
OUT_TRAIN_SAMPLE = DATA_PROCESSED_ETL / "ml_train_sigungu_daily_sample.csv"
OUT_TRAIN_1Y = ML_TRAIN_SIGUNGU_DAILY_1Y
TRAIN_LOOKBACK_DAYS = 365

TEST_START = "2025-01-01"
# XGB fit: date < CALIB_START / isotonic: CALIB_START ≤ date < TEST_START / 평가: ≥ TEST_START
CALIB_START = "2024-01-01"
# 기상 4 + 산불이력 2 + DWI + 강수파생 3 (7d/14d 누적 · 연속무강수, 전일까지)
FEATURE_COLS = [
    "temp_avg",
    "precip",
    "wind_avg",
    "humidity_avg",
    "hist_fire_rate",
    "hist_fire_count_365",
    "dwi",
    "precip_sum_7d",
    "precip_sum_14d",
    "dry_days",
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


def prepare_weather(w: pd.DataFrame) -> pd.DataFrame:
    """원본 기상만 정리 (파생 feature 없음). MariaDB Decimal → float."""
    w = w.sort_values(["sigungu_code", "date"]).copy()
    w["date"] = pd.to_datetime(w["date"])
    w["sigungu_code"] = w["sigungu_code"].astype(str)
    for col in ("temp_avg", "precip", "wind_avg", "humidity_avg"):
        if col in w.columns:
            w[col] = pd.to_numeric(w[col], errors="coerce")
    if "precip" in w.columns:
        w["precip"] = w["precip"].fillna(0.0)
    return w


def add_labels_and_history(df: pd.DataFrame, fire_labels: pd.DataFrame) -> pd.DataFrame:
    """시군구·일 산불 라벨 y + 과거 365일 이력 feature (누수 방지: 당일 제외)."""
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


def train_and_eval(
    df: pd.DataFrame,
) -> tuple[XGBClassifier, Any, dict, pd.DataFrame]:
    """XGB 학습 + 2024 hold-out Isotonic 보정 + 2025+ 테스트 평가.

    분할
    ----
    - fit   : date < CALIB_START (2024-01-01)
    - calib : CALIB_START ≤ date < TEST_START  → IsotonicRegression
    - test  : date ≥ TEST_START               → 지표·지도 점수
    """
    from sklearn.isotonic import IsotonicRegression
    from sklearn.metrics import brier_score_loss

    df = df.dropna(subset=FEATURE_COLS).copy()
    df["date_str"] = df["date"].dt.strftime("%Y-%m-%d")

    fit_df = df[df["date_str"] < CALIB_START]
    calib_df = df[(df["date_str"] >= CALIB_START) & (df["date_str"] < TEST_START)]
    test = df[df["date_str"] >= TEST_START]
    if fit_df.empty or calib_df.empty or test.empty:
        raise RuntimeError(
            f"분할 결과 비어 있음: fit={len(fit_df)} calib={len(calib_df)} test={len(test)}"
        )

    X_fit, y_fit = fit_df[FEATURE_COLS], fit_df["y"].astype(int)
    X_calib, y_calib = calib_df[FEATURE_COLS], calib_df["y"].astype(int)
    X_test, y_test = test[FEATURE_COLS], test["y"].astype(int)

    pos = int(y_fit.sum())
    neg = int(len(y_fit) - pos)
    spw = max(neg / max(pos, 1), 1.0)
    print(
        f"   분할 fit={len(fit_df):,}(~{CALIB_START})  "
        f"calib={len(calib_df):,}({CALIB_START}~{TEST_START})  "
        f"test={len(test):,}  fit양성={pos:,}  calib양성={int(y_calib.sum()):,}"
    )

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
    model.fit(X_fit, y_fit)

    raw_calib = model.predict_proba(X_calib)[:, 1]
    calibrator = IsotonicRegression(out_of_bounds="clip", y_min=0.0, y_max=1.0)
    calibrator.fit(raw_calib, y_calib.to_numpy())
    print(
        f"   Isotonic 보정 fit 완료  "
        f"raw_calib mean={raw_calib.mean():.4f}  "
        f"실제율={y_calib.mean():.4f}"
    )

    raw_test = model.predict_proba(X_test)[:, 1]
    proba = apply_calibration(raw_test, calibrator)

    thr = float(np.quantile(proba, 1 - min(0.05, max(y_test.mean() * 10, 0.01))))
    pred = (proba >= thr).astype(int)
    precision, recall, f1, _ = precision_recall_fscore_support(
        y_test, pred, average="binary", zero_division=0
    )
    metrics = {
        "test_start": TEST_START,
        "calib_start": CALIB_START,
        "calibration": "isotonic",
        "n_fit": int(len(fit_df)),
        "n_calib": int(len(calib_df)),
        "n_test": int(len(test)),
        "n_fit_pos": pos,
        "n_calib_pos": int(y_calib.sum()),
        "n_test_pos": int(y_test.sum()),
        "scale_pos_weight": round(spw, 2),
        "threshold": round(thr, 4),
        "roc_auc": round(float(roc_auc_score(y_test, proba)), 4),
        "roc_auc_raw": round(float(roc_auc_score(y_test, raw_test)), 4),
        "pr_auc": round(float(average_precision_score(y_test, proba)), 4),
        "brier": round(float(brier_score_loss(y_test, proba)), 6),
        "brier_raw": round(float(brier_score_loss(y_test, raw_test)), 6),
        "mean_pred": round(float(proba.mean()), 6),
        "mean_pred_raw": round(float(raw_test.mean()), 6),
        "base_rate_test": round(float(y_test.mean()), 6),
        "precision": round(float(precision), 4),
        "recall": round(float(recall), 4),
        "f1": round(float(f1), 4),
        "features": FEATURE_COLS,
    }

    test_out = test[
        ["date_str", "sigungu_code", "sigungu_name", "province", "y"]
    ].copy()
    test_out["y_prob"] = proba
    test_out["y_prob_raw"] = raw_test
    return model, calibrator, metrics, test_out


def region_scores(
    test_out: pd.DataFrame,
    full_df: pd.DataFrame,
    model: XGBClassifier,
    calibrator: Any | None = None,
) -> pd.DataFrame:
    """시군구별 위험점수: test 기간 평균 (보정)예측확률 + 봄철(2~5월) 평균."""
    X_all = full_df[FEATURE_COLS]
    full_df = full_df.copy()
    raw = model.predict_proba(X_all)[:, 1]
    full_df["y_prob"] = apply_calibration(raw, calibrator)
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


def load_weather_for_train() -> pd.DataFrame:
    """학습용 기상: MariaDB 우선, 실패 시 로컬 CSV."""
    try:
        from predict.weather_db import fetch_weather_daily_sigungu_df

        weather = fetch_weather_daily_sigungu_df()
        print(
            f"   기상 소스=MariaDB  rows={len(weather):,}  "
            f"{weather['date'].min().date()} ~ {weather['date'].max().date()}"
        )
        return weather
    except Exception as e:
        print(f"   MariaDB 기상 로드 실패 → CSV 폴백: {e}")
        if not WEATHER_DAILY_SIGUNGU.exists():
            raise FileNotFoundError(
                f"MariaDB 실패 후 CSV도 없음: {WEATHER_DAILY_SIGUNGU}"
            ) from e
        weather = pd.read_csv(WEATHER_DAILY_SIGUNGU, encoding="utf-8-sig")
        print(f"   기상 소스=CSV  rows={len(weather):,}  ({WEATHER_DAILY_SIGUNGU.name})")
        return weather


def load_fires_for_train() -> pd.DataFrame:
    """학습용 산불: MariaDB 우선 → 지도와 동일한 시도 약칭 정규화. CSV 폴백."""
    from map.build_admin_layers import load_fires
    from pipeline.load_wildfire_history import load_wildfire_history_raw

    raw = load_wildfire_history_raw()
    fires = load_fires(raw)
    print(f"   산불 정규화 후 rows={len(fires):,}  (raw {len(raw):,})")
    return fires


def main() -> None:
    ensure_dirs()
    print("1) 데이터 로드…")
    weather = load_weather_for_train()
    fires = load_fires_for_train()
    fires["date"] = pd.to_datetime(fires["date"], errors="coerce")
    fires = fires.dropna(subset=["date"])
    sig = load_sigungu()

    print("2) 산불 → 시군구 매칭…")
    fire_labels = match_fire_to_codes(fires, sig)
    print(f"   산불 원본 {len(fires)}건 → 라벨 {len(fire_labels)} (시군구·일)")

    print("3) 기상 원본 정리…")
    w = prepare_weather(weather)

    print("4) DWI 산출…")
    w = add_dwi_column(w)

    print("5) 강수 파생 feature (7d/14d·연속무강수)…")
    w = add_precip_feature_columns(w)

    print("6) 라벨 y + 이력 feature…")
    df = add_labels_and_history(w, fire_labels)
    print(f"   학습 후보 행 {len(df):,} / 양성 {int(df['y'].sum()):,} ({df['y'].mean()*100:.3f}%)")

    # 학습 직전: 최근 1년치 전체 테이블 저장 (피처·라벨 점검용)
    export_cols = [
        "date_str",
        "sigungu_code",
        "sigungu_name",
        "province",
        "y",
        *FEATURE_COLS,
    ]
    max_date = pd.to_datetime(df["date"]).max()
    start_1y = max_date - pd.Timedelta(days=TRAIN_LOOKBACK_DAYS - 1)
    df_1y = df[pd.to_datetime(df["date"]) >= start_1y].sort_values(
        ["date", "sigungu_code"]
    )
    out_1y = df_1y[export_cols].copy()
    out_1y.to_csv(OUT_TRAIN_1Y, index=False, encoding="utf-8-sig")
    print(
        f"   1년치 저장: {OUT_TRAIN_1Y.name}  "
        f"{start_1y.date()} ~ {max_date.date()}  "
        f"({len(out_1y):,}행 / 양성 {int(df_1y['y'].sum()):,})"
    )

    # 샘플 저장 (양성 전체 + 랜덤 음성)
    pos = df[df["y"] == 1]
    neg = df[df["y"] == 0].sample(n=min(5000, (df["y"] == 0).sum()), random_state=42)
    sample = pd.concat([pos, neg]).sort_values(["date", "sigungu_code"])
    sample_out = sample[export_cols].copy()
    sample_out.to_csv(OUT_TRAIN_SAMPLE, index=False, encoding="utf-8-sig")
    print(f"   샘플 저장: {OUT_TRAIN_SAMPLE.name} ({len(sample_out):,}행)")

    print("7) XGBoost 학습 + Isotonic 보정…")
    model, calibrator, metrics, test_out = train_and_eval(df)
    print(
        f"   ROC-AUC={metrics['roc_auc']} (raw {metrics['roc_auc_raw']})  "
        f"PR-AUC={metrics['pr_auc']}  "
        f"mean_pred={metrics['mean_pred']} (raw {metrics['mean_pred_raw']})  "
        f"base_rate={metrics['base_rate_test']}"
    )
    print(
        f"   P={metrics['precision']} R={metrics['recall']} F1={metrics['f1']}  "
        f"Brier={metrics['brier']} (raw {metrics['brier_raw']})"
    )

    imp = (
        pd.DataFrame({"feature": FEATURE_COLS, "importance": model.feature_importances_})
        .sort_values("importance", ascending=False)
    )
    imp.to_csv(OUT_IMP, index=False, encoding="utf-8-sig")
    metrics["top_features"] = imp.head(10).to_dict(orient="records")

    print("8) 시군구 위험점수…")
    scores = region_scores(test_out, df, model, calibrator)
    scores.to_csv(OUT_SCORES, index=False, encoding="utf-8-sig")

    web_payload = {
        "model": "xgboost_sigungu_daily",
        "test_start": TEST_START,
        "calibration": "isotonic",
        "metrics": {
            "roc_auc": metrics["roc_auc"],
            "pr_auc": metrics["pr_auc"],
            "precision": metrics["precision"],
            "recall": metrics["recall"],
            "f1": metrics["f1"],
            "mean_pred": metrics["mean_pred"],
            "base_rate_test": metrics["base_rate_test"],
        },
        "note": "ml_risk = 2025년 test 기간 일별 보정 예측확률 평균 (시군구)",
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

    print("9) 모델·보정기·추론용 상태 저장…")
    model.save_model(str(WILDFIRE_XGB_MODEL))
    save_calibrator(calibrator, WILDFIRE_XGB_CALIBRATOR)

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

    bundle = {
        "model_path": str(WILDFIRE_XGB_MODEL.relative_to(ROOT)).replace("\\", "/"),
        "calibrator_path": str(WILDFIRE_XGB_CALIBRATOR.relative_to(ROOT)).replace(
            "\\", "/"
        ),
        "calibration": "isotonic",
        "calib_start": CALIB_START,
        "features": FEATURE_COLS,
        "test_start": TEST_START,
        "trained_at": pd.Timestamp.now().isoformat(timespec="seconds"),
        "metrics": {
            "roc_auc": metrics["roc_auc"],
            "pr_auc": metrics["pr_auc"],
            "threshold": metrics["threshold"],
            "mean_pred": metrics["mean_pred"],
            "base_rate_test": metrics["base_rate_test"],
            "brier": metrics["brier"],
        },
        "hist_state": str(SIGUNGU_HIST_STATE.relative_to(ROOT)).replace("\\", "/"),
        "note": "daily.py: XGB raw → Isotonic 보정 확률 (기상4+이력2+DWI+강수파생3)",
    }
    WILDFIRE_XGB_BUNDLE.write_text(
        json.dumps(bundle, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"   {WILDFIRE_XGB_MODEL.name}")
    print(f"   {WILDFIRE_XGB_CALIBRATOR.name}")
    print(f"   {SIGUNGU_HIST_STATE.name}")
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
