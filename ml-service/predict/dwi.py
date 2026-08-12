"""일기상지수(DWI) 산출 — 사전기상지수(PreDWI) × 강우효과(RNE).

상대습도 = humidity_avg(일평균).
실효습도 He = (H0 + r H1 + r^2 H2) / (1 + r + r^2), r=0.7.
과거 습도·강수 결측 시 당일 값으로 대체.
"""

from __future__ import annotations

import math

import numpy as np
import pandas as pd

R_EFF = 0.7
HE_DENOM = 1.0 + R_EFF + R_EFF**2  # 2.19

# PreDWI → 정수 DWI(1~10) 상한 (포함). 봄=1~6월, 가을=7~12월
SPRING_PREDWI_CAPS = (
    0.1183,
    0.1878,
    0.2571,
    0.3320,
    0.4089,
    0.4932,
    0.5861,
    0.6862,
    0.7820,
)
AUTUMN_PREDWI_CAPS = (
    0.0265,
    0.0409,
    0.0575,
    0.0750,
    0.0968,
    0.1258,
    0.1601,
    0.2072,
    0.2859,
)


def is_spring(month: int) -> bool:
    return 1 <= int(month) <= 6


def effective_humidity(h0: float, h1: float | None, h2: float | None) -> float:
    """실효습도. h1/h2 없으면 h0로 대체."""
    v0 = float(h0)
    v1 = float(h1) if h1 is not None and h1 == h1 else v0
    v2 = float(h2) if h2 is not None and h2 == h2 else v0
    return (v0 + R_EFF * v1 + (R_EFF**2) * v2) / HE_DENOM


def class_rn2(mm: float) -> int:
    """2일전 강수 class (표 기준)."""
    x = max(0.0, float(mm))
    if x < 10:
        return 0
    return 1


def class_rn1(mm: float) -> int:
    """1일전 강수 class."""
    x = max(0.0, float(mm))
    if x < 5:
        return 0
    if x < 10:
        return 1
    return 2


def class_rnt(mm: float) -> int:
    """당일 강수 class."""
    x = max(0.0, float(mm))
    if x < 1:
        return 0
    if x < 5:
        return 1
    if x < 10:
        return 2
    return 3


def rne_temp(precip0: float, precip1: float | None, precip2: float | None) -> int:
    p0 = float(precip0) if precip0 == precip0 else 0.0
    p1 = float(precip1) if precip1 is not None and precip1 == precip1 else p0
    p2 = float(precip2) if precip2 is not None and precip2 == precip2 else p0
    return class_rn2(p2) + class_rn1(p1) + class_rnt(p0)


def rne_from_temp(rne_t: float) -> float:
    """RNE_Temp → RNE."""
    x = float(rne_t)
    if x < 2:
        return 1.0
    if x < 3:
        return 0.5
    if x < 4:
        return 0.4
    if x < 5:
        return 0.3
    if x < 6:
        return 0.2
    return 0.1


def predwi_spring(temp: float, rh: float, he: float, wind: float) -> float:
    z = 2.706 + 0.088 * temp - 0.055 * rh - 0.023 * he - 0.104 * wind
    return 1.0 / (1.0 + math.exp(-z))


def predwi_autumn(temp: float, rh: float, wind: float) -> float:
    z = 1.099 + 0.117 * temp - 0.069 * rh - 0.182 * wind
    return 1.0 / (1.0 + math.exp(-z))


def reclassify_predwi(predwi: float, month: int) -> int:
    caps = SPRING_PREDWI_CAPS if is_spring(month) else AUTUMN_PREDWI_CAPS
    p = float(predwi)
    for i, cap in enumerate(caps, start=1):
        if p <= cap:
            return i
    return 10


def compute_dwi(
    *,
    temp_avg: float,
    humidity_avg: float,
    wind_avg: float,
    precip: float,
    month: int,
    humidity_lag1: float | None = None,
    humidity_lag2: float | None = None,
    precip_lag1: float | None = None,
    precip_lag2: float | None = None,
) -> float:
    """스칼라 DWI = 재분류 PreDWI × RNE."""
    he = effective_humidity(humidity_avg, humidity_lag1, humidity_lag2)
    if is_spring(month):
        pre = predwi_spring(temp_avg, humidity_avg, he, wind_avg)
    else:
        pre = predwi_autumn(temp_avg, humidity_avg, wind_avg)
    level = reclassify_predwi(pre, month)
    rne = rne_from_temp(rne_temp(precip, precip_lag1, precip_lag2))
    return float(level) * rne


def add_dwi_column(df: pd.DataFrame) -> pd.DataFrame:
    """시군구×일 테이블에 dwi 컬럼 추가 (시군구별 lag, 결측→당일)."""
    out = df.sort_values(["sigungu_code", "date"]).copy()
    out["sigungu_code"] = out["sigungu_code"].astype(str)
    out["date"] = pd.to_datetime(out["date"])
    for col in ("temp_avg", "precip", "wind_avg", "humidity_avg"):
        if col in out.columns:
            out[col] = pd.to_numeric(out[col], errors="coerce")
    out["precip"] = out["precip"].fillna(0.0)
    out["month"] = out["date"].dt.month

    g = out.groupby("sigungu_code", sort=False)
    h0 = out["humidity_avg"].astype(float)
    h1 = g["humidity_avg"].shift(1)
    h2 = g["humidity_avg"].shift(2)
    h1 = h1.fillna(h0)
    h2 = h2.fillna(h0)
    he = (h0 + R_EFF * h1 + (R_EFF**2) * h2) / HE_DENOM

    p0 = out["precip"].astype(float)
    p1 = g["precip"].shift(1).fillna(p0)
    p2 = g["precip"].shift(2).fillna(p0)

    spring = out["month"].between(1, 6)
    z_s = (
        2.706
        + 0.088 * out["temp_avg"].astype(float)
        - 0.055 * h0
        - 0.023 * he
        - 0.104 * out["wind_avg"].astype(float)
    )
    z_a = (
        1.099
        + 0.117 * out["temp_avg"].astype(float)
        - 0.069 * h0
        - 0.182 * out["wind_avg"].astype(float)
    )
    predwi = np.where(spring, 1.0 / (1.0 + np.exp(-z_s)), 1.0 / (1.0 + np.exp(-z_a)))

    caps_s = np.array(SPRING_PREDWI_CAPS, dtype=float)
    caps_a = np.array(AUTUMN_PREDWI_CAPS, dtype=float)

    def _level(p: float, spring_row: bool) -> int:
        caps = caps_s if spring_row else caps_a
        for i, cap in enumerate(caps, start=1):
            if p <= cap:
                return i
        return 10

    level = np.array(
        [_level(float(p), bool(s)) for p, s in zip(predwi, spring)],
        dtype=float,
    )

    # RNE_Temp via vectorized class
    def _c2(x: np.ndarray) -> np.ndarray:
        return np.where(x >= 10, 1, 0).astype(float)

    def _c1(x: np.ndarray) -> np.ndarray:
        return np.where(x >= 10, 2, np.where(x >= 5, 1, 0)).astype(float)

    def _c0(x: np.ndarray) -> np.ndarray:
        return np.where(
            x >= 10, 3, np.where(x >= 5, 2, np.where(x >= 1, 1, 0))
        ).astype(float)

    rne_t = _c2(p2.to_numpy()) + _c1(p1.to_numpy()) + _c0(p0.to_numpy())
    rne = np.where(
        rne_t < 2,
        1.0,
        np.where(
            rne_t < 3,
            0.5,
            np.where(
                rne_t < 4,
                0.4,
                np.where(rne_t < 5, 0.3, np.where(rne_t < 6, 0.2, 0.1)),
            ),
        ),
    )

    out["dwi"] = level * rne
    out = out.drop(columns=["month"])
    return out
