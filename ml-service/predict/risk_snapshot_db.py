"""당일 예측 스냅샷 → MariaDB (DB_* 1번).

당일 KMA 예측이 끝나면 daily_ml_risk_runs 1행 + daily_ml_risk_regions 255행을 적재한다.
같은 observed_at 이면 UPSERT 후 해당 런의 시군구 행을 갈아끼운다.

접속은 산불/기상과 같은 ml-service/.env 의 DB_HOST … DB_NAME 을 사용한다.
시나리오 예측은 호출하지 않는다.
"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Any

logger = logging.getLogger(__name__)


def _as_float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        v = float(value)
    except (TypeError, ValueError):
        return None
    if v != v:  # NaN
        return None
    return v


def _parse_observed_at(raw: Any, predict_date: str) -> datetime:
    """payload.observed_at ('YYYY-MM-DD HH:MM') → DATETIME. 파싱 실패 시 예측일 00:00."""
    s = str(raw or "").strip()
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%d"):
        try:
            return datetime.strptime(s, fmt)
        except ValueError:
            continue
    try:
        return datetime.strptime(str(predict_date)[:10], "%Y-%m-%d")
    except ValueError:
        return datetime.now()


def save_daily_ml_risk_snapshot(payload: dict) -> bool:
    """당일 예측 payload 를 1번 DB(DB_*)에 적재. 성공 True, 건너뜀/실패 False.

    예측 HTTP 응답은 막지 않는다. DB_* 없거나 테이블 미생성이면 로그만 남긴다.
    """
    from predict.weather_db import db_config

    cfg = db_config()
    if cfg is None:
        logger.warning(
            "DB_* 환경변수 없음 — 당일 예측 스냅샷을 DB에 적재하지 않음"
        )
        return False

    try:
        import pymysql
    except ImportError:
        logger.warning("PyMySQL 미설치 — 당일 예측 스냅샷 적재 생략")
        return False

    predict_date = str(payload.get("predict_date") or "")[:10]
    observed_at = _parse_observed_at(payload.get("observed_at"), predict_date)
    weather_source = str(payload.get("weather_source") or "")[:64]
    note = payload.get("note")
    n_regions = payload.get("n_regions")
    sample = payload.get("sample_weather") or {}
    metrics = payload.get("model_metrics") or {}
    regions = payload.get("regions") or []
    if not isinstance(regions, list):
        regions = []

    run_sql = """
        INSERT INTO daily_ml_risk_runs (
            predict_date, observed_at, weather_source, n_regions, note,
            sample_temp_avg, sample_precip, sample_wind_avg, sample_humidity_avg,
            roc_auc, pr_auc, threshold, mean_pred, base_rate_test, brier
        ) VALUES (
            %s, %s, %s, %s, %s,
            %s, %s, %s, %s,
            %s, %s, %s, %s, %s, %s
        )
        ON DUPLICATE KEY UPDATE
            id = LAST_INSERT_ID(id),
            predict_date = VALUES(predict_date),
            weather_source = VALUES(weather_source),
            n_regions = VALUES(n_regions),
            note = VALUES(note),
            sample_temp_avg = VALUES(sample_temp_avg),
            sample_precip = VALUES(sample_precip),
            sample_wind_avg = VALUES(sample_wind_avg),
            sample_humidity_avg = VALUES(sample_humidity_avg),
            roc_auc = VALUES(roc_auc),
            pr_auc = VALUES(pr_auc),
            threshold = VALUES(threshold),
            mean_pred = VALUES(mean_pred),
            base_rate_test = VALUES(base_rate_test),
            brier = VALUES(brier)
    """
    run_args = (
        predict_date or None,
        observed_at,
        weather_source or None,
        int(n_regions) if n_regions is not None else len(regions),
        note,
        _as_float(sample.get("temp_avg")),
        _as_float(sample.get("precip")),
        _as_float(sample.get("wind_avg")),
        _as_float(sample.get("humidity_avg")),
        _as_float(metrics.get("roc_auc")),
        _as_float(metrics.get("pr_auc")),
        _as_float(metrics.get("threshold")),
        _as_float(metrics.get("mean_pred")),
        _as_float(metrics.get("base_rate_test")),
        _as_float(metrics.get("brier")),
    )

    region_rows: list[tuple] = []
    for item in regions:
        if not isinstance(item, dict):
            continue
        code = str(item.get("code") or "").strip()
        if not code:
            continue
        ml_risk = _as_float(item.get("ml_risk"))
        ml_risk_norm = _as_float(item.get("ml_risk_norm"))
        if ml_risk is None or ml_risk_norm is None:
            continue
        region_rows.append(
            (
                code[:10],
                str(item.get("name") or "")[:50],
                str(item.get("province") or "")[:20],
                ml_risk,
                ml_risk_norm,
                _as_float(item.get("humidity_avg")),
                _as_float(item.get("temp_avg")),
                _as_float(item.get("precip")),
                _as_float(item.get("wind_avg")),
            )
        )

    conn = pymysql.connect(**cfg)
    try:
        with conn.cursor() as cur:
            cur.execute(run_sql, run_args)
            run_id = cur.lastrowid
            if not run_id:
                cur.execute(
                    "SELECT id FROM daily_ml_risk_runs WHERE observed_at = %s",
                    (observed_at,),
                )
                row = cur.fetchone()
                run_id = row[0] if row else None
            if not run_id:
                raise RuntimeError("daily_ml_risk_runs id 를 얻지 못했습니다")

            cur.execute(
                "DELETE FROM daily_ml_risk_regions WHERE run_id = %s",
                (run_id,),
            )
            if region_rows:
                cur.executemany(
                    """
                    INSERT INTO daily_ml_risk_regions (
                        run_id, code, name, province, ml_risk, ml_risk_norm,
                        humidity_avg, temp_avg, precip, wind_avg
                    ) VALUES (
                        %s, %s, %s, %s, %s, %s,
                        %s, %s, %s, %s
                    )
                    """,
                    [(run_id, *row) for row in region_rows],
                )
        conn.commit()
        logger.info(
            "당일 예측 스냅샷 적재(DB_*) observed_at=%s run_id=%s regions=%d",
            observed_at,
            run_id,
            len(region_rows),
        )
        return True
    except Exception:
        conn.rollback()
        logger.exception("당일 예측 스냅샷 적재 실패 (DB_*) — 예측 응답은 유지")
        return False
    finally:
        conn.close()
