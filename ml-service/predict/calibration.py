"""Isotonic 확률 보정 — XGB raw predict_proba → 현실 빈도에 가까운 확률.

학습: 2024 hold-out 에서 IsotonicRegression fit 후 joblib 저장.
예측: raw 점수에 calibrator.predict 적용.
보정 파일이 없으면 raw 를 그대로 반환 (하위 호환).
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import numpy as np

try:
    from ml_paths import WILDFIRE_XGB_CALIBRATOR
except ImportError:
    WILDFIRE_XGB_CALIBRATOR = Path(__file__).resolve().parents[2] / "db" / "output" / "wildfire_xgb_calibrator.joblib"


def save_calibrator(calibrator: Any, path: Path | None = None) -> Path:
    import joblib

    out = path or WILDFIRE_XGB_CALIBRATOR
    out.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(calibrator, out)
    return out


def load_calibrator(path: Path | None = None) -> Any | None:
    import joblib

    p = path or WILDFIRE_XGB_CALIBRATOR
    if not p.exists():
        return None
    return joblib.load(p)


def apply_calibration(
    raw_proba: np.ndarray | list[float],
    calibrator: Any | None,
) -> np.ndarray:
    """raw ∈ [0,1] → calibrated ∈ [0,1]. calibrator 없으면 raw 복사."""
    raw = np.asarray(raw_proba, dtype=float).ravel()
    if calibrator is None:
        return raw.copy()
    cal = np.asarray(calibrator.predict(raw), dtype=float).ravel()
    return np.clip(cal, 0.0, 1.0)
