"""SPI(표준강수지수) — 지점 일자료 → 시군구×일 매핑.

원본: db-archive/raw/spi/daily_spi_1991~2026.csv (station_id, Daily_SPI_1)
매핑: db/processed/sigungu_asos_station.csv (시군구→ASOS 지점)
출력: db/processed/spi_daily_sigungu.csv
"""

from __future__ import annotations

from pathlib import Path

import pandas as pd

from paths import DAILY_SPI_RAW, SIGUNGU_ASOS_STATION, SPI_DAILY_SIGUNGU, ensure_dirs


def build_spi_daily_sigungu(
    *,
    raw_path: Path | None = None,
    assign_path: Path | None = None,
    out_path: Path | None = None,
) -> pd.DataFrame:
    """지점 SPI를 대표 ASOS 지점 기준으로 시군구×일에 복제."""
    ensure_dirs()
    raw_path = raw_path or DAILY_SPI_RAW
    assign_path = assign_path or SIGUNGU_ASOS_STATION
    out_path = out_path or SPI_DAILY_SIGUNGU

    if not raw_path.exists():
        raise FileNotFoundError(raw_path)
    if not assign_path.exists():
        raise FileNotFoundError(assign_path)

    spi = pd.read_csv(
        raw_path,
        usecols=["station_id", "date", "Daily_SPI_1"],
    )
    spi = spi.rename(columns={"station_id": "stn_id", "Daily_SPI_1": "spi"})
    spi["stn_id"] = spi["stn_id"].astype(int)
    spi["date"] = pd.to_datetime(spi["date"], errors="coerce")
    spi = spi.dropna(subset=["date", "spi"]).copy()
    spi["spi"] = pd.to_numeric(spi["spi"], errors="coerce")
    spi = spi.dropna(subset=["spi"])

    assign = pd.read_csv(assign_path, encoding="utf-8-sig")
    assign["stn_id"] = assign["stn_id"].astype(int)
    assign["sigungu_code"] = assign["sigungu_code"].astype(str)

    merged = assign.merge(spi, on="stn_id", how="inner")
    out = (
        merged[
            [
                "date",
                "sigungu_code",
                "sigungu_name",
                "province",
                "stn_id",
                "stn_name",
                "spi",
            ]
        ]
        .sort_values(["date", "sigungu_code"])
        .drop_duplicates(["date", "sigungu_code"], keep="last")
        .reset_index(drop=True)
    )
    out["date"] = out["date"].dt.strftime("%Y-%m-%d")
    out.to_csv(out_path, index=False, encoding="utf-8-sig")
    return out


def load_spi_daily_sigungu(*, rebuild: bool = False) -> pd.DataFrame:
    """시군구×일 SPI. 없으면 빌드."""
    if rebuild or not SPI_DAILY_SIGUNGU.exists():
        return build_spi_daily_sigungu()
    df = pd.read_csv(SPI_DAILY_SIGUNGU, encoding="utf-8-sig")
    df["sigungu_code"] = df["sigungu_code"].astype(str)
    df["date"] = pd.to_datetime(df["date"])
    return df


def attach_spi(weather: pd.DataFrame, spi: pd.DataFrame | None = None) -> pd.DataFrame:
    """기상 테이블에 spi 컬럼 inner-join (겹치는 시군구·일만 유지)."""
    if spi is None:
        spi = load_spi_daily_sigungu()
    w = weather.copy()
    w["sigungu_code"] = w["sigungu_code"].astype(str)
    w["date"] = pd.to_datetime(w["date"])
    s = spi.copy()
    s["sigungu_code"] = s["sigungu_code"].astype(str)
    s["date"] = pd.to_datetime(s["date"])
    s = s[["sigungu_code", "date", "spi"]]
    before = len(w)
    out = w.merge(s, on=["sigungu_code", "date"], how="inner")
    print(f"   SPI join: {before:,} → {len(out):,}행 (겹치는 시군구·일)")
    return out
