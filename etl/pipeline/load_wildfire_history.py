"""산불 이력 로드 — MariaDB forestfire_stats 우선, refined CSV 폴백.

학습·맵·분석 스크립트가 공통으로 사용한다.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pandas as pd

# etl/ · ml-service/
_ETL = Path(__file__).resolve().parents[1]
_ROOT = _ETL.parent
_ML = _ROOT / "ml-service"
for p in (_ETL, _ML):
    if str(p) not in sys.path:
        sys.path.insert(0, str(p))

from paths import REFINED_WILDFIRE  # noqa: E402


def load_wildfire_history_raw() -> pd.DataFrame:
    """refined CSV와 동일 스키마의 산불 DataFrame.

    컬럼: date, datetime, hour, time, province, city, town, village,
          damage_area, cause, region_path, is_fire
    """
    try:
        from predict.fire_db import fetch_forestfire_stats_df

        df = fetch_forestfire_stats_df()
        print(f"   산불 소스=MariaDB forestfire_stats  rows={len(df):,}")
        return df
    except Exception as e:
        if not REFINED_WILDFIRE.exists():
            raise FileNotFoundError(
                f"MariaDB 산불 로드 실패 후 CSV도 없음 ({REFINED_WILDFIRE}): {e}"
            ) from e
        print(f"   MariaDB 산불 로드 실패 → CSV 폴백: {e}")
        df = pd.read_csv(REFINED_WILDFIRE)
        print(f"   산불 소스=CSV  rows={len(df):,}  ({REFINED_WILDFIRE.name})")
        return df


def count_wildfire_history() -> int:
    """전체 산불 건수 (맵 meta.total_fires 등)."""
    return int(len(load_wildfire_history_raw()))
