"""강수 파생 feature — SPI 대체.

규칙 (예측일 D 기준, D 당일 제외 · 전일까지):
  - precip_sum_7d  : D-1 … D-7 강수 합 (mm)
  - precip_sum_14d : D-1 … D-14 강수 합 (mm)
  - dry_days       : D-1부터 거슬러 올라가며 precip <= 0 인 연속 일수
                     (비 온 날(precip > 0)에서 끊김)

결측·없는 날짜는 0mm 로 채운다.
"""

from __future__ import annotations

from datetime import date, timedelta
from typing import Mapping

import pandas as pd

PRECIP_FEATURE_COLS = [
    "precip_sum_7d",
    "precip_sum_14d",
    "dry_days",
]

# 예측 시 연속 무강수·14일 합산용 과거 조회 일수
PRECIP_LOOKBACK_DAYS = 90


def _precip_at(history: Mapping[date, float], d: date) -> float:
    v = history.get(d)
    if v is None:
        return 0.0
    try:
        x = float(v)
    except (TypeError, ValueError):
        return 0.0
    if x != x:  # NaN
        return 0.0
    return x


def compute_precip_features_for_date(
    pred_date: date | str,
    precip_by_date: Mapping[date, float],
    *,
    dry_lookback: int = PRECIP_LOOKBACK_DAYS,
) -> dict[str, float]:
    """단일 예측일·시군구에 대한 강수 feature."""
    if isinstance(pred_date, str):
        pred = date.fromisoformat(str(pred_date)[:10])
    else:
        pred = pred_date

    sum7 = 0.0
    for i in range(1, 8):
        sum7 += _precip_at(precip_by_date, pred - timedelta(days=i))

    sum14 = 0.0
    for i in range(1, 15):
        sum14 += _precip_at(precip_by_date, pred - timedelta(days=i))

    dry = 0
    for i in range(1, int(dry_lookback) + 1):
        p = _precip_at(precip_by_date, pred - timedelta(days=i))
        if p <= 0:
            dry += 1
        else:
            break

    return {
        "precip_sum_7d": float(sum7),
        "precip_sum_14d": float(sum14),
        "dry_days": float(dry),
    }


def add_precip_feature_columns(df: pd.DataFrame) -> pd.DataFrame:
    """시군구×일 테이블에 precip_sum_7d / precip_sum_14d / dry_days 추가.

    시군구별 달력을 채운 뒤(빈 날 0mm) 전일 기준 rolling·연속일을 계산한다.
    """
    if df.empty:
        out = df.copy()
        for c in PRECIP_FEATURE_COLS:
            out[c] = 0.0
        return out

    out = df.copy()
    out["sigungu_code"] = out["sigungu_code"].astype(str)
    out["date"] = pd.to_datetime(out["date"], errors="coerce").dt.normalize()
    out["precip"] = pd.to_numeric(out["precip"], errors="coerce").fillna(0.0)

    parts: list[pd.DataFrame] = []
    for code, grp in out.groupby("sigungu_code", sort=False):
        g = grp.dropna(subset=["date"]).sort_values("date")
        if g.empty:
            continue
        # 같은 날 중복이면 평균
        s = g.groupby("date", sort=True)["precip"].mean()
        full_idx = pd.date_range(s.index.min(), s.index.max(), freq="D")
        s = s.reindex(full_idx).fillna(0.0)

        sum7 = s.shift(1).rolling(7, min_periods=1).sum().fillna(0.0)
        sum14 = s.shift(1).rolling(14, min_periods=1).sum().fillna(0.0)

        is_dry = s <= 0
        run_id = (~is_dry).cumsum()
        streak = is_dry.astype(int).groupby(run_id).cumsum()
        dry_before = streak.shift(1).fillna(0).astype(float)

        parts.append(
            pd.DataFrame(
                {
                    "date": full_idx,
                    "sigungu_code": str(code),
                    "precip_sum_7d": sum7.to_numpy(dtype=float),
                    "precip_sum_14d": sum14.to_numpy(dtype=float),
                    "dry_days": dry_before.to_numpy(dtype=float),
                }
            )
        )

    if not parts:
        for c in PRECIP_FEATURE_COLS:
            out[c] = 0.0
        return out

    feats = pd.concat(parts, ignore_index=True)
    out = out.drop(columns=[c for c in PRECIP_FEATURE_COLS if c in out.columns], errors="ignore")
    out = out.merge(feats, on=["sigungu_code", "date"], how="left")
    for c in PRECIP_FEATURE_COLS:
        out[c] = pd.to_numeric(out[c], errors="coerce").fillna(0.0)
    return out
