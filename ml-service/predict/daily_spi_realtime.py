"""
당일 SPI (단일 파일, 프로젝트 내부 모듈 의존 없음).

- 감마 적합: CSV 과거 일별 강수 + climate_indices (scale=30 기본)
- 당일 scale 창 관측: 기상청 API
    · 어제까지(29일): kma_sfcdd3 일강수 RN_DAY
    · 오늘: kma_sfctm3 시간자료 당일 누적

외부 패키지: numpy, pandas, climate_indices, requests
인증키: ml-service/.env 의 KMA_API_AUTH_KEY (또는 KMA_AUTH_KEY)

사용 예 (ml-service 에서):
  python -m predict.daily_spi_realtime --stn 108
  python -m predict.daily_spi_realtime --stn 108 --as-of 202608031300
  python -m predict.daily_spi_realtime --all
"""

from __future__ import annotations

import argparse
import calendar
import os
import re
import warnings
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path

import numpy as np
import pandas as pd
import requests
from climate_indices import compute, indices

# ---------------------------------------------------------------------------
# 경로 / 기본값
# ---------------------------------------------------------------------------
HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
_SPI_DIR = ROOT / "db-archive" / "raw" / "spi"
DEFAULT_INPUT = _SPI_DIR / "daily_precipitation_filled.csv"
DEFAULT_OUTPUT = _SPI_DIR / "daily_spi_realtime.csv"
DEFAULT_SCALE = 30
DEFAULT_CALIBRATION_START = 1971
DEFAULT_CALIBRATION_END = 2020

DAILY_URL = "https://apihub.kma.go.kr/api/typ01/url/kma_sfcdd3.php"
HOURLY_URL = "https://apihub.kma.go.kr/api/typ01/url/kma_sfctm3.php"
MISSING = -9.0
DAILY_RN_DAY_IDX = 38  # kma_sfcdd3 help 기준 0-based
HOURLY_RN_IDX = 15
HOURLY_RN_DAY_IDX = 16
_HELP_FIELD_RE = re.compile(r"^#\s*\d+\.\s*([A-Za-z0-9_]+)\s*:")
_AUTH_KEY_NAMES = ("KMA_API_AUTH_KEY", "KMA_AUTH_KEY")


# ---------------------------------------------------------------------------
# 인증키 (.env / 환경변수)
# ---------------------------------------------------------------------------


def load_auth_key() -> str:
    """KMA_API_AUTH_KEY 우선, 없으면 KMA_AUTH_KEY. 환경변수 또는 .env."""
    for name in _AUTH_KEY_NAMES:
        key = os.getenv(name)
        if key:
            return key

    try:
        from dotenv import load_dotenv
    except ImportError:
        load_dotenv = None  # type: ignore

    candidates = [
        HERE / ".env",
        HERE.parent / ".env",  # ml-service/.env
        ROOT / "ml-service" / ".env",
        Path.cwd() / ".env",
    ]
    for env_path in candidates:
        if not env_path.is_file():
            continue
        if load_dotenv is not None:
            load_dotenv(env_path)
        else:
            for line in env_path.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, _, v = line.partition("=")
                k = k.strip()
                if k in _AUTH_KEY_NAMES:
                    os.environ.setdefault(k, v.strip().strip('"').strip("'"))
        for name in _AUTH_KEY_NAMES:
            key = os.getenv(name)
            if key:
                return key

    raise SystemExit(
        "KMA_API_AUTH_KEY 가 없습니다. ml-service/.env 에 "
        "KMA_API_AUTH_KEY=발급키 를 넣어 주세요."
    )


# ---------------------------------------------------------------------------
# SPI 유틸 (climate_indices daily 규약)
# ---------------------------------------------------------------------------


def classify_spi_value(x: float) -> str | float:
    """McKee et al. (1995) 가뭄 등급."""
    if pd.isna(x):
        return np.nan
    if x <= -2.0:
        return "Extremely dry"
    if x <= -1.5:
        return "Severe dry"
    if x <= -1.0:
        return "Moderately dry"
    if x < 1.0:
        return "Near normal"
    if x < 1.5:
        return "Moderately wet"
    if x < 2.0:
        return "Very wet"
    return "Extremely wet"


def align_to_leap_year_calendar(
    dates: pd.DatetimeIndex, prcp: np.ndarray, start_year: int, end_year: int
) -> tuple[list[pd.Timestamp | None], np.ndarray]:
    """매 연도 366칸. 평년 2/29 = 2/28·3/1 평균."""
    series = pd.Series(prcp, index=dates)
    values: list[float] = []
    value_dates: list[pd.Timestamp | None] = []

    for year in range(start_year, end_year + 1):
        year_end = pd.Timestamp(year=year, month=12, day=31)
        if year == end_year:
            year_end = min(year_end, dates.max())

        for day in pd.date_range(pd.Timestamp(year=year, month=1, day=1), year_end, freq="D"):
            values.append(series.get(day, np.nan))
            value_dates.append(day)

            if day.month == 2 and day.day == 28 and not calendar.isleap(year):
                feb28 = series.get(day, np.nan)
                mar1 = series.get(pd.Timestamp(year=year, month=3, day=1), np.nan)
                observed = [v for v in (feb28, mar1) if not np.isnan(v)]
                synthetic = float(np.mean(observed)) if observed else np.nan
                values.append(synthetic)
                value_dates.append(None)

    return value_dates, np.array(values, dtype=float)


# ---------------------------------------------------------------------------
# 기상청 API — 호출 시점 기준 scale일 일별 강수
# ---------------------------------------------------------------------------


@dataclass
class DailyPrecip:
    date: str  # YYYYMMDD
    rn_day_mm: float
    source: str  # daily | hourly_partial


@dataclass
class StationPrecipSeries:
    stn: int
    days: list[DailyPrecip]
    as_of: str  # YYYYMMDDHHMM


def _as_precip(v: float) -> float | None:
    if v <= MISSING or v < 0:
        return None
    return v


def _floor_hour(dt: datetime) -> datetime:
    return dt.replace(minute=0, second=0, microsecond=0)


def _date_list(start: datetime, end: datetime) -> list[datetime]:
    out: list[datetime] = []
    cur = start.replace(hour=0, minute=0, second=0, microsecond=0)
    end = end.replace(hour=0, minute=0, second=0, microsecond=0)
    while cur <= end:
        out.append(cur)
        cur += timedelta(days=1)
    return out


def fetch_daily_period(tm1: str, tm2: str, stn: int, auth_key: str) -> str:
    resp = requests.get(
        DAILY_URL,
        params={"tm1": tm1, "tm2": tm2, "stn": stn, "help": 0, "authKey": auth_key},
        timeout=300,
    )
    resp.raise_for_status()
    return resp.content.decode("euc-kr", errors="replace")


def fetch_hourly_period(tm1: str, tm2: str, stn: int, auth_key: str) -> str:
    resp = requests.get(
        HOURLY_URL,
        params={"tm1": tm1, "tm2": tm2, "stn": stn, "help": 0, "authKey": auth_key},
        timeout=120,
    )
    resp.raise_for_status()
    return resp.content.decode("euc-kr", errors="replace")


def parse_sfcdd3(text: str) -> list[list[str]]:
    rows: list[list[str]] = []
    for raw in text.splitlines():
        line = raw.rstrip()
        if not line or line.startswith("#"):
            continue
        parts = line.split()
        if len(parts) < 2 or len(parts[0]) != 8 or not parts[0].isdigit():
            continue
        rows.append(parts)
    return rows


def parse_sfctm3(text: str) -> list[list[str]]:
    rows: list[list[str]] = []
    for raw in text.splitlines():
        line = raw.rstrip()
        if not line or line.startswith("#"):
            continue
        parts = line.split()
        if len(parts) < 3 or not parts[0].isdigit() or len(parts[0]) < 10:
            continue
        rows.append(parts)
    return rows


def parse_daily_rn_map(rows: list[list[str]]) -> dict[tuple[int, str], float]:
    out: dict[tuple[int, str], float] = {}
    for r in rows:
        if len(r) <= DAILY_RN_DAY_IDX:
            continue
        try:
            day = r[0][:8]
            stn = int(r[1])
            rn = _as_precip(float(r[DAILY_RN_DAY_IDX]))
        except ValueError:
            continue
        if rn is None:
            continue
        out[(stn, day)] = rn
    return out


def today_precip_by_station(rows: list[list[str]]) -> dict[int, float]:
    last_rn_day: dict[int, tuple[str, float]] = {}
    rn_sums: dict[int, float] = defaultdict(float)

    for r in rows:
        if len(r) <= max(HOURLY_RN_IDX, HOURLY_RN_DAY_IDX):
            continue
        try:
            tm = r[0]
            stn = int(r[1])
        except ValueError:
            continue
        try:
            rn = _as_precip(float(r[HOURLY_RN_IDX]))
        except ValueError:
            rn = None
        if rn is not None:
            rn_sums[stn] += rn
        try:
            rn_day = _as_precip(float(r[HOURLY_RN_DAY_IDX]))
        except ValueError:
            rn_day = None
        if rn_day is not None:
            prev = last_rn_day.get(stn)
            if prev is None or tm >= prev[0]:
                last_rn_day[stn] = (tm, rn_day)

    result: dict[int, float] = {}
    for stn in set(last_rn_day) | set(rn_sums):
        if stn in last_rn_day:
            result[stn] = last_rn_day[stn][1]
        else:
            result[stn] = rn_sums.get(stn, 0.0)
    return result


def precip_daily_series(
    stn: int,
    auth_key: str,
    *,
    as_of: datetime | None = None,
    lookback_days: int = DEFAULT_SCALE,
    quiet: bool = False,
) -> dict[int, StationPrecipSeries]:
    """
    호출 시점 기준 과거 lookback_days 일별 강수.
    완료일=일자료 RN_DAY, 오늘=시간자료 당일 누적.
    """
    if lookback_days < 1:
        raise ValueError("lookback_days 는 1 이상이어야 합니다.")

    now = _floor_hour(as_of if as_of is not None else datetime.now())
    today = now.replace(hour=0, minute=0, second=0, microsecond=0)
    first_day = today - timedelta(days=lookback_days - 1)
    as_of_s = now.strftime("%Y%m%d%H%M")
    today_s = today.strftime("%Y%m%d")

    daily_map: dict[tuple[int, str], float] = {}
    full_days = lookback_days - 1
    if full_days > 0:
        past_to = today - timedelta(days=1)
        past_from = today - timedelta(days=full_days)
        tm1, tm2 = past_from.strftime("%Y%m%d"), past_to.strftime("%Y%m%d")
        if not quiet:
            print(f"[일자료] tm1={tm1} tm2={tm2} stn={stn}", flush=True)
        text = fetch_daily_period(tm1, tm2, stn, auth_key)
        rows = parse_sfcdd3(text)
        if not quiet:
            print(f"  → {len(rows)}행", flush=True)
        daily_map = parse_daily_rn_map(rows)

    start_h = today
    end_h = now if now >= start_h else start_h
    tm1h, tm2h = start_h.strftime("%Y%m%d%H%M"), end_h.strftime("%Y%m%d%H%M")
    if not quiet:
        print(f"[시간자료·오늘] tm1={tm1h} tm2={tm2h} stn={stn}", flush=True)
    h_text = fetch_hourly_period(tm1h, tm2h, stn, auth_key)
    h_rows = parse_sfctm3(h_text)
    if not quiet:
        print(f"  → {len(h_rows)}행", flush=True)
    today_map = today_precip_by_station(h_rows)

    if stn != 0:
        stations = {stn}
    else:
        stations = {s for (s, _) in daily_map} | set(today_map)

    calendar_days = _date_list(first_day, today)
    out: dict[int, StationPrecipSeries] = {}
    for s in stations:
        days: list[DailyPrecip] = []
        for d in calendar_days:
            ds = d.strftime("%Y%m%d")
            if ds == today_s:
                days.append(
                    DailyPrecip(ds, today_map.get(s, 0.0), "hourly_partial")
                )
            else:
                days.append(
                    DailyPrecip(ds, daily_map.get((s, ds), 0.0), "daily")
                )
        out[s] = StationPrecipSeries(stn=s, days=days, as_of=as_of_s)
    return out


# ---------------------------------------------------------------------------
# SPI 파이프라인
# ---------------------------------------------------------------------------


def load_hist_prcp(path: Path, station_ids: list[int] | None) -> pd.DataFrame:
    df = pd.read_csv(path, encoding="utf-8-sig")
    required = {"station_id", "station_name", "date", "prcp"}
    missing = required - set(df.columns)
    if missing:
        raise ValueError(f"CSV 필수 컬럼 없음: {sorted(missing)}")
    df["station_id"] = df["station_id"].astype(int)
    df["date"] = pd.to_datetime(df["date"])
    if station_ids is not None:
        df = df[df["station_id"].isin(station_ids)].copy()
        if df.empty:
            raise ValueError(f"CSV에 해당 지점 없음: {station_ids}")
    return df


def overlay_api_days(
    hist: pd.DataFrame,
    api_days: list[DailyPrecip],
    as_of_date: pd.Timestamp,
) -> pd.DataFrame:
    station_id = int(hist["station_id"].iloc[0])
    station_name = hist["station_name"].iloc[0]
    hist = hist.sort_values("date")
    start = hist["date"].min()
    end = max(hist["date"].max(), as_of_date.normalize())

    full_idx = pd.date_range(start, end, freq="D")
    series = hist.set_index("date")["prcp"].reindex(full_idx).astype(float)

    for d in api_days:
        day = pd.Timestamp(datetime.strptime(d.date, "%Y%m%d"))
        if start <= day <= end:
            series.loc[day] = float(d.rn_day_mm)

    return pd.DataFrame(
        {
            "station_id": station_id,
            "station_name": station_name,
            "date": series.index,
            "prcp": series.to_numpy(dtype=float),
        }
    )


def compute_spi_series(
    group: pd.DataFrame,
    scale: int,
    calibration_year_initial: int,
    calibration_year_final: int,
) -> pd.DataFrame:
    group = group.sort_values("date").copy()
    dates = pd.DatetimeIndex(pd.to_datetime(group["date"]))
    prcp = group["prcp"].to_numpy(dtype=float)

    data_start_year = int(dates.min().year)
    data_end_year = int(dates.max().year)
    cal_start = max(calibration_year_initial, data_start_year)
    cal_end = min(calibration_year_final, data_end_year)
    if cal_start > cal_end:
        raise ValueError(
            f"Invalid calibration: station {group['station_id'].iloc[0]} "
            f"{cal_start} > {cal_end}"
        )

    value_dates, aligned_prcp = align_to_leap_year_calendar(
        dates, prcp, data_start_year, data_end_year
    )

    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        spi_values = indices.spi(
            values=aligned_prcp,
            scale=scale,
            distribution=indices.Distribution.gamma,
            data_start_year=data_start_year,
            calibration_year_initial=cal_start,
            calibration_year_final=cal_end,
            periodicity=compute.Periodicity.daily,
        )

    spi_by_date = {d: v for d, v in zip(value_dates, spi_values) if d is not None}
    group = group.copy()
    group["Daily_SPI_1"] = [spi_by_date.get(d, np.nan) for d in dates]
    group["SPI_category"] = group["Daily_SPI_1"].map(classify_spi_value)
    return group


def window_sum(prcp: pd.Series, scale: int) -> float:
    vals = prcp.tail(scale).to_numpy(dtype=float)
    if np.any(~np.isfinite(vals)):
        return float("nan")
    return float(np.nansum(vals))


def compute_realtime_spi(
    hist_df: pd.DataFrame,
    api_by_stn: dict[int, StationPrecipSeries],
    as_of: datetime,
    scale: int,
    cal_start: int,
    cal_end: int,
    *,
    quiet: bool = False,
) -> pd.DataFrame:
    as_of_date = pd.Timestamp(as_of).normalize()
    rows: list[dict] = []
    station_ids = sorted(hist_df["station_id"].unique())

    for i, sid in enumerate(station_ids, start=1):
        hist = hist_df[hist_df["station_id"] == sid]
        name = hist["station_name"].iloc[0]
        series = api_by_stn.get(sid)
        if series is None:
            if not quiet:
                print(f"[{i}/{len(station_ids)}] STN {sid} ({name}): API 없음 → skip", flush=True)
            continue

        merged = overlay_api_days(hist, series.days, as_of_date)
        full = compute_spi_series(merged, scale, cal_start, cal_end)
        day_row = full[full["date"] == as_of_date]
        if day_row.empty:
            if not quiet:
                print(f"[{i}/{len(station_ids)}] STN {sid} ({name}): as_of 행 없음 → skip", flush=True)
            continue

        r = day_row.iloc[0]
        prcp_sum = window_sum(full.set_index("date")["prcp"].sort_index(), scale)
        api_sum = sum(d.rn_day_mm for d in series.days)
        spi_v = r["Daily_SPI_1"]
        cat = r["SPI_category"]
        if not quiet:
            print(
                f"[{i}/{len(station_ids)}] STN {sid} ({name}): "
                f"API30합={api_sum:.2f}  scale창합={prcp_sum:.2f}  "
                f"SPI={spi_v if pd.notna(spi_v) else 'nan'}  {cat}",
                flush=True,
            )
        rows.append(
            {
                "station_id": sid,
                "station_name": name,
                "date": as_of_date.strftime("%Y-%m-%d"),
                "as_of": series.as_of,
                "scale": scale,
                "api_prcp_30d_sum": round(api_sum, 2),
                "scale_window_prcp_sum": (
                    round(prcp_sum, 2) if np.isfinite(prcp_sum) else np.nan
                ),
                "Daily_SPI_1": spi_v,
                "SPI_category": cat if pd.notna(cat) else "",
                "calibration_start": cal_start,
                "calibration_end": cal_end,
            }
        )

    return pd.DataFrame(rows)


def compute_spi_by_station(
    *,
    as_of: datetime | None = None,
    input_path: Path | None = None,
    station_ids: list[int] | None = None,
    scale: int = DEFAULT_SCALE,
    cal_start: int = DEFAULT_CALIBRATION_START,
    cal_end: int = DEFAULT_CALIBRATION_END,
    quiet: bool = True,
) -> dict[int, float]:
    """as_of 기준 지점별 Daily_SPI_1. 예측 엔진에서 import 용.

    station_ids=None 이면 CSV 전 지점 + API stn=0.
    """
    input_path = input_path or DEFAULT_INPUT
    if not input_path.exists():
        raise FileNotFoundError(input_path)

    if as_of is None:
        as_of = datetime.now().replace(minute=0, second=0, microsecond=0)

    hist_df = load_hist_prcp(input_path, station_ids)
    target_ids = sorted(hist_df["station_id"].unique())
    api_stn = 0 if station_ids is None or len(target_ids) != 1 else target_ids[0]

    auth_key = load_auth_key()
    api_all = precip_daily_series(
        api_stn,
        auth_key,
        as_of=as_of,
        lookback_days=scale,
        quiet=quiet,
    )
    api_by_stn = {sid: api_all[sid] for sid in target_ids if sid in api_all}
    if not api_by_stn:
        raise RuntimeError("API 응답에 CSV 지점이 없습니다.")

    result = compute_realtime_spi(
        hist_df,
        api_by_stn,
        as_of,
        scale=scale,
        cal_start=cal_start,
        cal_end=cal_end,
        quiet=quiet,
    )
    out: dict[int, float] = {}
    for r in result.itertuples(index=False):
        v = r.Daily_SPI_1
        if v is None or (isinstance(v, float) and not np.isfinite(v)):
            continue
        out[int(r.station_id)] = float(v)
    return out


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="당일 SPI (CSV 감마 적합 + API 30일 관측, 단일 파일)"
    )
    p.add_argument("--input", type=Path, default=DEFAULT_INPUT, help="일별 강수 CSV")
    p.add_argument("--output", type=Path, default=DEFAULT_OUTPUT, help="결과 CSV")
    p.add_argument("--scale", type=int, default=DEFAULT_SCALE)
    p.add_argument("--calibration-start", type=int, default=DEFAULT_CALIBRATION_START)
    p.add_argument("--calibration-end", type=int, default=DEFAULT_CALIBRATION_END)
    p.add_argument("--as-of", default=None, help="기준 시각 YYYYMMDDHHMM")
    p.add_argument("--stn", type=int, nargs="*", default=None, help="지점번호")
    p.add_argument("--all", action="store_true", help="CSV 전 지점 (API stn=0)")
    return p.parse_args()


def main() -> None:
    args = parse_args()
    if not args.input.exists():
        raise FileNotFoundError(
            f"CSV 없음: {args.input}\n"
            "Place at db-archive/raw/spi/daily_precipitation_filled.csv"
        )

    if args.as_of:
        as_of = datetime.strptime(args.as_of, "%Y%m%d%H%M")
    else:
        as_of = datetime.now().replace(minute=0, second=0, microsecond=0)

    if args.all:
        station_ids = None
        api_stn = 0
    else:
        station_ids = args.stn if args.stn else [108]
        api_stn = station_ids[0] if len(station_ids) == 1 else 0

    hist_df = load_hist_prcp(args.input, station_ids)
    target_ids = sorted(hist_df["station_id"].unique())
    print(
        f"기준 as_of={as_of.strftime('%Y%m%d%H%M')}  scale={args.scale}  "
        f"cal={args.calibration_start}~{args.calibration_end}  "
        f"stations={len(target_ids)}",
        flush=True,
    )

    auth_key = load_auth_key()
    print(
        f"[API] stn={api_stn}  {args.scale}일 일별 강수 조회…",
        flush=True,
    )
    api_all = precip_daily_series(
        api_stn,
        auth_key,
        as_of=as_of,
        lookback_days=args.scale,
        quiet=False,
    )
    api_by_stn = {sid: api_all[sid] for sid in target_ids if sid in api_all}
    if not api_by_stn:
        raise SystemExit("API 응답에 CSV 지점이 없습니다.")

    result = compute_realtime_spi(
        hist_df,
        api_by_stn,
        as_of,
        scale=args.scale,
        cal_start=args.calibration_start,
        cal_end=args.calibration_end,
    )
    if result.empty:
        raise SystemExit("SPI 결과가 비었습니다.")

    args.output.parent.mkdir(parents=True, exist_ok=True)
    result.to_csv(args.output, index=False, encoding="utf-8-sig")
    print(f"\nsaved {args.output}: {len(result)} rows")
    print(result.to_string(index=False))


if __name__ == "__main__":
    main()
