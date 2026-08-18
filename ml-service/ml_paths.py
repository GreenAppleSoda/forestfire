"""ml-service 전용 경로 상수.

predict/ 예측 기능(daily · scenario)이 필요로 하는 경로만 모아 둡니다.
이 파일 덕분에 예측 기능은 etl/ 폴더 없이도 동작합니다.

웹 산불이력 갱신은 Express(backend/)가 담당합니다.
etl 배치 파이프라인 전체 경로는 etl/paths.py 를 참고하세요.
"""

from __future__ import annotations

import os
from pathlib import Path

SERVICE_DIR = Path(__file__).resolve().parent
ROOT = SERVICE_DIR.parent

DB = ROOT / "db"
DATA_PROCESSED = DB / "processed"
DATA_OUTPUT = DB / "output"

# frontend와 공유하는 정적 데이터 폴더. 성능 최적화를 위해 의도적으로 공유합니다
# (docs/초기로딩-성능최적화-보고서.md 참고). 다른 위치를 쓰려면 ml-service/.env에
# WEB_DATA_DIR(절대경로)을 지정하세요.
WEB_DATA_DIR = Path(os.environ.get("WEB_DATA_DIR") or (ROOT / "frontend" / "public" / "data"))

SIGUNGU_ASOS_STATION = DATA_PROCESSED / "sigungu_asos_station.csv"
WEATHER_DAILY_SIGUNGU = DATA_PROCESSED / "weather_daily_sigungu.csv"
SIGUNGU_HIST_STATE = DATA_PROCESSED / "sigungu_hist_state.csv"

WILDFIRE_XGB_MODEL = DATA_OUTPUT / "wildfire_xgb_model.json"
WILDFIRE_XGB_BUNDLE = DATA_OUTPUT / "wildfire_xgb_bundle.json"

DAILY_ML_RISK = WEB_DATA_DIR / "daily_ml_risk.json"


def ensure_dirs() -> None:
    for d in (DATA_PROCESSED, DATA_OUTPUT, WEB_DATA_DIR):
        d.mkdir(parents=True, exist_ok=True)
