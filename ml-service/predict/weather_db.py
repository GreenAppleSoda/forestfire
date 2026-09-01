"""MariaDB weather_daily_sigungu — 전체 로드(학습) · lag 조회(예측) · 월 평년."""

from __future__ import annotations

import logging
import os
from datetime import date, datetime, timedelta
from typing import Any

logger = logging.getLogger(__name__)

# pred_date(YYYY-MM-DD) → sigungu_code → {date → (humidity_avg, precip)}
_lag_cache: dict[str, dict[str, dict[date, tuple[float | None, float | None]]]] = {}
# pred_date|lookback → sigungu_code → {obs_date → precip}
_precip_hist_cache: dict[str, dict[str, dict[date, float]]] = {}
# MONTH(obs_date) 1..12 → 기온·습도·바람·강수 전 기간 평균 (성공 시에만 채움)
_month_clim_cache: dict[int, dict[str, Any]] | None = None


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
    global _month_clim_cache
    _lag_cache.clear()
    _precip_hist_cache.clear()
    _month_clim_cache = None


def fetch_month_climatology(month: int | None = None) -> dict[int, dict[str, Any]]:
    """weather_daily_sigungu 해당 월 · 전 기간 평균과 10·90분위.

    month를 주면 그달만 조회해 캐시에 넣는다. 평균(mean)과 p10/p90을 같이 둔다.
    반환: month(1..12) → {
      temp_avg, humidity_avg, wind_avg, precip,
      temp_p10, temp_p90, humidity_p10, humidity_p90,
      wind_p10, wind_p90, precip_p10, precip_p90,
      start_date, end_date, n_rows, n_years
    }
    DB 미설정·실패 시 해당 월은 비어 있음 (호출측 폴백).
    """
    global _month_clim_cache
    if _month_clim_cache is None:
        _month_clim_cache = {}
    if month is None:
        return _month_clim_cache
    m = int(month)
    if m < 1 or m > 12:
        return _month_clim_cache
    if m in _month_clim_cache:
        return _month_clim_cache
    row = _query_month_climatology(m)
    if row:
        _month_clim_cache[m] = row
    return _month_clim_cache


def _query_month_climatology(month: int) -> dict[str, Any] | None:
    cfg = db_config()
    if cfg is None:
        logger.warning("DB_* 환경변수 없음 — 월 평년은 DB에서 읽지 않음")
        return None

    try:
        import pymysql
    except ImportError:
        logger.warning("PyMySQL 미설치 — 월 평년 미조회")
        return None

    try:
        conn = pymysql.connect(**{**cfg, "read_timeout": 60})
        try:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT
                      AVG(temp_avg) AS temp_avg,
                      MIN(temp_p10) AS temp_p10,
                      MIN(temp_p90) AS temp_p90,
                      AVG(humidity_avg) AS humidity_avg,
                      MIN(humidity_p10) AS humidity_p10,
                      MIN(humidity_p90) AS humidity_p90,
                      AVG(wind_avg) AS wind_avg,
                      MIN(wind_p10) AS wind_p10,
                      MIN(wind_p90) AS wind_p90,
                      AVG(precip) AS precip,
                      MIN(precip_p10) AS precip_p10,
                      MIN(precip_p90) AS precip_p90,
                      MIN(obs_date) AS start_date,
                      MAX(obs_date) AS end_date,
                      COUNT(*) AS n_rows,
                      COUNT(DISTINCT y) AS n_years
                    FROM (
                      SELECT
                        temp_avg,
                        humidity_avg,
                        wind_avg,
                        COALESCE(precip, 0) AS precip,
                        obs_date,
                        YEAR(obs_date) AS y,
                        PERCENTILE_CONT(0.1) WITHIN GROUP (ORDER BY temp_avg)
                          OVER () AS temp_p10,
                        PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY temp_avg)
                          OVER () AS temp_p90,
                        PERCENTILE_CONT(0.1) WITHIN GROUP (ORDER BY humidity_avg)
                          OVER () AS humidity_p10,
                        PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY humidity_avg)
                          OVER () AS humidity_p90,
                        PERCENTILE_CONT(0.1) WITHIN GROUP (ORDER BY wind_avg)
                          OVER () AS wind_p10,
                        PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY wind_avg)
                          OVER () AS wind_p90,
                        PERCENTILE_CONT(0.1) WITHIN GROUP (ORDER BY COALESCE(precip, 0))
                          OVER () AS precip_p10,
                        PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY COALESCE(precip, 0))
                          OVER () AS precip_p90
                      FROM weather_daily_sigungu
                      WHERE MONTH(obs_date) = %s
                    ) t
                    """,
                    (month,),
                )
                rec = cur.fetchone()
        finally:
            conn.close()
    except Exception as e:
        logger.warning("MariaDB 월 평년·분위 조회 실패 month=%s: %s", month, e)
        return None

    if not rec:
        return None

    (
        temp_avg,
        temp_p10,
        temp_p90,
        humidity_avg,
        humidity_p10,
        humidity_p90,
        wind_avg,
        wind_p10,
        wind_p90,
        precip,
        precip_p10,
        precip_p90,
        start_date,
        end_date,
        n_rows,
        n_years,
    ) = rec
    t = _as_float(temp_avg)
    h = _as_float(humidity_avg)
    w = _as_float(wind_avg)
    p = _as_float(precip)
    if t is None or h is None or w is None or p is None:
        return None

    sd = _as_date(start_date)
    ed = _as_date(end_date)
    out = {
        "temp_avg": round(t, 1),
        "humidity_avg": round(h, 1),
        "wind_avg": round(w, 1),
        "precip": round(max(0.0, p), 1),
        "temp_p10": _as_float(temp_p10),
        "temp_p90": _as_float(temp_p90),
        "humidity_p10": _as_float(humidity_p10),
        "humidity_p90": _as_float(humidity_p90),
        "wind_p10": _as_float(wind_p10),
        "wind_p90": _as_float(wind_p90),
        "precip_p10": _as_float(precip_p10),
        "precip_p90": _as_float(precip_p90),
        "start_date": sd.isoformat() if sd else None,
        "end_date": ed.isoformat() if ed else None,
        "n_rows": int(n_rows or 0),
        "n_years": int(n_years or 0),
    }
    for key in (
        "temp_p10",
        "temp_p90",
        "humidity_p10",
        "humidity_p90",
        "wind_p10",
        "wind_p90",
        "precip_p10",
        "precip_p90",
    ):
        val = out[key]
        if val is not None:
            if key.startswith("precip"):
                out[key] = round(max(0.0, float(val)), 1)
            else:
                out[key] = round(float(val), 1)

    logger.info(
        "MariaDB 월 평년·분위 month=%s years=%s n=%s",
        month,
        out["n_years"],
        out["n_rows"],
    )
    return out


def fetch_precip_history_for_pred_date(
    pred_date: str,
    *,
    lookback_days: int = 90,
) -> dict[str, dict[date, float]]:
    """예측일 전 lookback_days 일간의 precip (pred_date 당일 제외).

    반환: sigungu_code → {obs_date → precip}
    없는 날짜는 호출측에서 0으로 취급한다.
    """
    key = f"{str(pred_date)[:10]}|{int(lookback_days)}"
    if key in _precip_hist_cache:
        return _precip_hist_cache[key]

    cfg = db_config()
    if cfg is None:
        logger.warning("DB_* 환경변수 없음 — precip history 미조회")
        _precip_hist_cache[key] = {}
        return _precip_hist_cache[key]

    try:
        pred = date.fromisoformat(str(pred_date)[:10])
    except ValueError:
        _precip_hist_cache[key] = {}
        return _precip_hist_cache[key]

    start = pred - timedelta(days=int(lookback_days))
    end = pred - timedelta(days=1)  # 전일까지

    try:
        import pymysql
    except ImportError:
        logger.warning("PyMySQL 미설치 — precip history 미조회")
        _precip_hist_cache[key] = {}
        return _precip_hist_cache[key]

    idx: dict[str, dict[date, float]] = {}
    try:
        conn = pymysql.connect(**cfg)
        try:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT obs_date, sigungu_code, precip
                    FROM weather_daily_sigungu
                    WHERE obs_date >= %s AND obs_date <= %s
                    """,
                    (start.isoformat(), end.isoformat()),
                )
                for obs_date, sigungu_code, precip in cur.fetchall():
                    od = _as_date(obs_date)
                    if od is None:
                        continue
                    code = str(sigungu_code).strip()
                    p = _as_float(precip)
                    idx.setdefault(code, {})[od] = 0.0 if p is None else p
        finally:
            conn.close()
    except Exception as e:
        logger.warning("MariaDB precip history 조회 실패: %s", e)
        _precip_hist_cache[key] = {}
        return _precip_hist_cache[key]

    logger.info(
        "MariaDB precip history: pred=%s range=%s~%s sigungu=%d",
        str(pred_date)[:10],
        start.isoformat(),
        end.isoformat(),
        len(idx),
    )
    _precip_hist_cache[key] = idx
    return idx


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
