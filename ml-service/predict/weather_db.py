"""MariaDB weather_daily_sigungu — 전체 로드(학습) · lag 조회(예측)"""

from __future__ import annotations

import logging
import os
from datetime import date, datetime, timedelta
from typing import Any

logger = logging.getLogger(__name__)

# pred_date(YYYY-MM-DD) → sigungu_code → {date → (humidity_avg, precip)}
_lag_cache: dict[str, dict[str, dict[date, tuple[float | None, float | None]]]] = {}


def _load_root_env() -> None:
    """루트·ml-service .env 를 os.environ 에 반영 (이미 있으면 유지)."""
    try:
        from config import ROOT, SERVICE_DIR, load_dotenv
    except ImportError:
        from pathlib import Path

        here = Path(__file__).resolve().parents[1]
        root = here.parent

        def load_dotenv(path):  # type: ignore[misc]
            if not path.exists():
                return
            for line in path.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, val = line.split("=", 1)
                os.environ.setdefault(key.strip(), val.strip().strip('"').strip("'"))

        load_dotenv(root / ".env")
        load_dotenv(here / ".env")
        return

    load_dotenv(ROOT / ".env")
    load_dotenv(SERVICE_DIR / ".env")


def db_config() -> dict[str, Any] | None:
    _load_root_env()
    host = (os.environ.get("DB_HOST") or "").strip()
    user = (os.environ.get("DB_USER") or "").strip()
    password = os.environ.get("DB_PASSWORD")
    if password is not None:
        password = password.strip()
    name = (os.environ.get("DB_NAME") or "").strip()
    port_raw = (os.environ.get("DB_PORT") or "3306").strip()
    if not all([host, user, password is not None and password != "", name]):
        return None
    return {
        "host": host,
        "user": user,
        "password": password,
        "database": name,
        "port": int(port_raw or "3306"),
        "charset": "utf8mb4",
        "connect_timeout": 15,
        "read_timeout": 60,
    }


def _as_date(value: Any) -> date | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    s = str(value).strip()[:10]
    try:
        return date.fromisoformat(s)
    except ValueError:
        return None


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


def fetch_lag_index_for_pred_date(
    pred_date: str,
) -> dict[str, dict[date, tuple[float | None, float | None]]]:
    """예측일 기준 1·2일 전 행만 조회.

    반환: sigungu_code → {obs_date → (humidity_avg, precip)}
    DB 미설정·실패 시 빈 dict.
    """
    key = str(pred_date)[:10]
    if key in _lag_cache:
        return _lag_cache[key]

    cfg = db_config()
    if cfg is None:
        logger.warning("DB_* 환경변수 없음 — lag 기상은 DB에서 읽지 않음")
        _lag_cache[key] = {}
        return _lag_cache[key]

    try:
        pred = date.fromisoformat(key)
    except ValueError:
        _lag_cache[key] = {}
        return _lag_cache[key]

    d1 = pred - timedelta(days=1)
    d2 = pred - timedelta(days=2)

    try:
        import pymysql
    except ImportError:
        logger.warning("PyMySQL 미설치 — pip install PyMySQL")
        _lag_cache[key] = {}
        return _lag_cache[key]

    idx: dict[str, dict[date, tuple[float | None, float | None]]] = {}
    try:
        conn = pymysql.connect(**cfg)
        try:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT obs_date, sigungu_code, humidity_avg, precip
                    FROM weather_daily_sigungu
                    WHERE obs_date IN (%s, %s)
                    """,
                    (d2.isoformat(), d1.isoformat()),
                )
                for obs_date, sigungu_code, humidity_avg, precip in cur.fetchall():
                    od = _as_date(obs_date)
                    if od is None:
                        continue
                    code = str(sigungu_code).strip()
                    bucket = idx.setdefault(code, {})
                    bucket[od] = (_as_float(humidity_avg), _as_float(precip))
        finally:
            conn.close()
    except Exception as e:
        logger.warning("MariaDB lag 조회 실패: %s", e)
        _lag_cache[key] = {}
        return _lag_cache[key]

    logger.info(
        "MariaDB lag 기상: pred=%s days=%s,%s sigungu=%d",
        key,
        d2.isoformat(),
        d1.isoformat(),
        len(idx),
    )
    _lag_cache[key] = idx
    return idx


def clear_lag_cache() -> None:
    _lag_cache.clear()


def fetch_weather_daily_sigungu_df():
    """학습용: weather_daily_sigungu 전체 → CSV와 동일한 컬럼의 DataFrame.

    컬럼: date, sigungu_code, sigungu_name, province, stn_id, stn_name,
          temp_avg, precip, wind_avg, humidity_avg
    """
    import pandas as pd

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

    # 전체 기간(~140만 행) 로드용으로 read_timeout 연장
    cfg = {**cfg, "read_timeout": 600, "connect_timeout": 30}
    sql = """
        SELECT
            obs_date AS date,
            sigungu_code,
            sigungu_name,
            province,
            stn_id,
            stn_name,
            temp_avg,
            precip,
            wind_avg,
            humidity_avg
        FROM weather_daily_sigungu
        ORDER BY obs_date, sigungu_code
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
        raise RuntimeError("weather_daily_sigungu 조회 결과가 비어 있습니다.")

    df["sigungu_code"] = df["sigungu_code"].astype(str)
    df["date"] = pd.to_datetime(df["date"], errors="coerce")
    df = df.dropna(subset=["date"]).reset_index(drop=True)
    logger.info(
        "MariaDB weather_daily_sigungu 로드: rows=%d range=%s~%s",
        len(df),
        df["date"].min().date(),
        df["date"].max().date(),
    )
    return df
