"""프로젝트 경로 상수. 모든 ETL 스크립트는 이 모듈을 통해 경로를 참조합니다.

구조
----
  frontend/     Next.js UI
  backend/      Express 공개 API
  ml-service/   Flask 예측
  etl/          오프라인 ETL · 분석 · 학습
  db/           서버 배포용 (XGBoost 예측 런타임)
  db-archive/   ETL·분석 원본·중간 산출물 보관
"""

from pathlib import Path

# ForestFire/ (프로젝트 루트)
ROOT = Path(__file__).resolve().parent.parent

ETL = ROOT / "etl"
FRONTEND = ROOT / "frontend"
FRONTEND_PUBLIC_DATA = FRONTEND / "public" / "data"
FRONTEND_ENV_LOCAL = FRONTEND / ".env.local"
ML_SERVICE_ENV = ROOT / "ml-service" / ".env"

# 서버 배포용 (예측 런타임)
DB = ROOT / "db"
DATA_PROCESSED = DB / "processed"
DATA_OUTPUT = DB / "output"

# ETL·분석 보관
DB_ARCHIVE = ROOT / "db-archive"
DATA_RAW = DB_ARCHIVE / "raw"
DATA_PROCESSED_ETL = DB_ARCHIVE / "processed"
DATA_OUTPUT_ETL = DB_ARCHIVE / "output"
GEO_DIR = DATA_RAW / "geo"

# 원본 (archive)
RAW_WILDFIRE = DATA_RAW / "wildfire_2011_2026.json"
KOREA_MOUNTAINS_JSON = DATA_RAW / "korea_mountains.json"

# 전처리·수집 (archive)
REFINED_WILDFIRE = DATA_PROCESSED_ETL / "refined_wildfire_data.csv"
MOUNTAIN_DATA = DATA_PROCESSED_ETL / "mountain_data.csv"
MOUNTAIN_LOCATION = DATA_PROCESSED_ETL / "mountain_location.csv"
MOUNTAIN_COORDS = DATA_PROCESSED_ETL / "mountain_coords.csv"
MOUNTAIN_GEOCODE_CACHE = DATA_PROCESSED_ETL / "mountain_geocode_cache.json"

# 기상 (ASOS)
RAW_ASOS_DAILY = DATA_RAW / "weather" / "asos_daily_2011_2026.csv"
ASOS_STATION_SIGUNGU_MAP = DATA_PROCESSED_ETL / "asos_station_sigungu_map.csv"
# 예측 런타임에 필요 → db/
WEATHER_DAILY_SIGUNGU = DATA_PROCESSED / "weather_daily_sigungu.csv"
WEATHER_DAILY_ASOS = DATA_PROCESSED_ETL / "weather_daily_asos.csv"
SIGUNGU_ASOS_STATION = DATA_PROCESSED / "sigungu_asos_station.csv"
# SPI (당일: daily_spi_realtime.py, 학습 매핑본: processed)
DAILY_PRECIP_FILLED = DATA_RAW / "spi" / "daily_precipitation_filled.csv"
DAILY_SPI_RAW = DATA_RAW / "spi" / "daily_spi_1971~2020.csv"
SPI_DAILY_SIGUNGU = DATA_PROCESSED / "spi_daily_sigungu.csv"

# 분석 결과 (archive)
CITY_RISK = DATA_OUTPUT_ETL / "city_wildfire_risk.csv"

WILDFIRE_MOUNTAIN_EVENTS = DATA_OUTPUT_ETL / "wildfire_mountain_events.csv"
WILDFIRE_WITH_MOUNTAINS = DATA_OUTPUT_ETL / "wildfire_with_mountains.csv"
WILDFIRE_BY_MOUNTAIN = DATA_OUTPUT_ETL / "wildfire_by_mountain.csv"
WILDFIRE_MOUNTAIN_EVENTS_SUMMARY = DATA_OUTPUT_ETL / "wildfire_mountain_events_summary.json"

# XGBoost — 모델·번들은 서버용 db/, 학습 로그는 archive
WILDFIRE_XGB_METRICS = DATA_OUTPUT_ETL / "wildfire_xgb_metrics.json"
SIGUNGU_ML_RISK_SCORES = DATA_OUTPUT_ETL / "sigungu_ml_risk_scores.csv"
WILDFIRE_XGB_IMPORTANCE = DATA_OUTPUT_ETL / "wildfire_xgb_feature_importance.csv"
WILDFIRE_XGB_MODEL = DATA_OUTPUT / "wildfire_xgb_model.json"
WILDFIRE_XGB_BUNDLE = DATA_OUTPUT / "wildfire_xgb_bundle.json"
SIGUNGU_HIST_STATE = DATA_PROCESSED / "sigungu_hist_state.csv"
DAILY_ML_RISK = FRONTEND_PUBLIC_DATA / "daily_ml_risk.json"
ADMIN_SIDO_JSON = FRONTEND_PUBLIC_DATA / "admin-sido.json"
ADMIN_SIGUNGU_JSON = FRONTEND_PUBLIC_DATA / "admin-sigungu.json"
ADMIN_EMD_JSON = FRONTEND_PUBLIC_DATA / "admin-emd.json"
SIGUNGU_ML_SCORES_WEB = FRONTEND_PUBLIC_DATA / "sigungu_ml_scores.json"
MAP_DATA_JSON = FRONTEND_PUBLIC_DATA / "map-data.json"
KOREA_SIGUNGU_PATHS = FRONTEND_PUBLIC_DATA / "korea-sigungu-paths.json"

# OpenAPI 산불 통계 증분 동기화 (archive)
WILDFIRE_OPENAPI_STATE = DATA_PROCESSED_ETL / "wildfire_openapi_sync_state.json"
WILDFIRE_OPENAPI_RAW = DATA_PROCESSED_ETL / "wildfire_openapi_incremental.json"


def ensure_dirs() -> None:
    for d in (
        DATA_RAW,
        DATA_PROCESSED,
        DATA_OUTPUT,
        DATA_PROCESSED_ETL,
        DATA_OUTPUT_ETL,
        GEO_DIR,
        FRONTEND_PUBLIC_DATA,
    ):
        d.mkdir(parents=True, exist_ok=True)
