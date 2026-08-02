"""예측 엔진 — Flask 라우트·CLI가 공유하는 모듈."""

from predict.daily import run_daily_predict

__all__ = ["run_daily_predict"]
