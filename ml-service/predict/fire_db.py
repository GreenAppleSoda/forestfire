"""MariaDB forestfire_stats — 산불 이력 전체 로드."""

from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)


def fetch_forestfire_stats_df():
    """forestfire_stats 전체 → refined CSV와 호환되는 DataFrame.

    컬럼: date, datetime, hour, time, province, city, town, village,
          damage_area, cause, region_path, is_fire
    """
    import pandas as pd

    from predict.weather_db import db_config

    cfg = db_config()
    if cfg is None:
        raise RuntimeError(
            "DB_* 환경변수가 없습니다. ml-service/.env 에 "
            "DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME 을 설정하세요."
        )

    try:
        import pymysql
    except ImportError as e:
        raise RuntimeError("PyMySQL 미설치 — pip install PyMySQL") from e

    cfg = {**cfg, "read_timeout": 120, "connect_timeout": 30}
    sql = """
        SELECT
            `date`,
            `datetime`,
            province,
            city,
            town,
            village,
            damage_area,
            cause,
            region_path,
            is_fire
        FROM forestfire_stats
        ORDER BY `datetime` DESC
    """
    conn = pymysql.connect(**cfg)
    try:
        with conn.cursor() as cur:
            cur.execute(sql)
            rows = cur.fetchall()
            cols = [d[0] for d in cur.description]
        df = pd.DataFrame(rows, columns=cols)
    finally:
        conn.close()

    if df.empty:
        raise RuntimeError("forestfire_stats 조회 결과가 비어 있습니다.")

    df["datetime"] = pd.to_datetime(df["datetime"], errors="coerce")
    df["date"] = pd.to_datetime(df["date"], errors="coerce")
    df = df.dropna(subset=["date", "datetime"]).copy()
    df["hour"] = df["datetime"].dt.hour.astype(int)
    df["time"] = df["datetime"].dt.strftime("%H:%M:%S")
    for c in ("province", "city", "town", "village", "cause", "region_path"):
        df[c] = df[c].fillna("").astype(str).str.strip()
    df["damage_area"] = pd.to_numeric(df["damage_area"], errors="coerce").fillna(0.0)
    df["is_fire"] = pd.to_numeric(df["is_fire"], errors="coerce").fillna(1).astype(int)

    # refined CSV 컬럼 순서
    out = df[
        [
            "date",
            "datetime",
            "hour",
            "time",
            "province",
            "city",
            "town",
            "village",
            "damage_area",
            "cause",
            "region_path",
            "is_fire",
        ]
    ].copy()
    out["date"] = out["date"].dt.strftime("%Y-%m-%d")
    out["datetime"] = out["datetime"].dt.strftime("%Y-%m-%d %H:%M:%S")

    logger.info(
        "MariaDB forestfire_stats 로드: rows=%d range=%s~%s",
        len(out),
        out["date"].min(),
        out["date"].max(),
    )
    return out
