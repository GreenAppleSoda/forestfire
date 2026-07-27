"""프로젝트 경로 상수. 모든 ETL 스크립트는 이 모듈을 통해 경로를 참조합니다.

구조
----
  frontend/     Next.js UI
  backend/      Express 공개 API
  ml-service/   Flask 예측
  etl/          오프라인 ETL · 분석 · 학습
    pipeline/ analyze/ map/ ml/
  db/           원본·전처리·분석 산출물
"""

from pathlib import Path

# ForestFire/ (프로젝트 루트)
ROOT = Path(__file__).resolve().parent.parent

ETL = ROOT / "etl"
FRONTEND = ROOT / "frontend"
FRONTEND_PUBLIC_DATA = FRONTEND / "public" / "data"
FRONTEND_ENV_LOCAL = FRONTEND / ".env.local"
ML_SERVICE_ENV = ROOT / "ml-service" / ".env"
BACKEND_ENV = ROOT / "backend" / ".env"

# 하위 호환 별칭
BACKEND = ETL
SERVER_ENV = BACKEND_ENV

DB = ROOT / "db"
DATA_RAW = DB / "raw"
DATA_PROCESSED = DB / "processed"
DATA_OUTPUT = DB / "output"
GEO_DIR = DATA_RAW / "geo"

# 원본
RAW_WILDFIRE = DATA_RAW / "wildfire_2011_2026.json"
RAW_WILDFIRE_SOURCE = DATA_RAW / "110101~260723.json"
RAW_WILDFIRE_LEGACY_CSV = DATA_RAW / "산림청_산불통계데이터_20250911.csv"
KOREA_MOUNTAINS_JSON = DATA_RAW / "korea_mountains.json"

# 전처리·수집
REFINED_WILDFIRE = DATA_PROCESSED / "refined_wildfire_data.csv"
MOUNTAIN_DATA = DATA_PROCESSED / "mountain_data.csv"
MOUNTAIN_LOCATION = DATA_PROCESSED / "mountain_location.csv"
MOUNTAIN_COORDS = DATA_PROCESSED / "mountain_coords.csv"
MOUNTAIN_COORDS_JSON = DATA_PROCESSED / "mountain_coords.json"
MOUNTAIN_GEOCODE_CACHE = DATA_PROCESSED / "mountain_geocode_cache.json"

# 기상 (ASOS) — 2011~어제 통합본
RAW_ASOS_DAILY = DATA_RAW / "weather" / "asos_daily_2011_2026.csv"
RAW_ASOS_PARTS = (
    DATA_RAW / "weather" / "parts" / "OBS_ASOS_DD_20260724095459.csv",
    DATA_RAW / "weather" / "parts" / "OBS_ASOS_DD_20260724100405.csv",
)
WEATHER_DAILY_ASOS = DATA_PROCESSED / "weather_daily_asos.csv"
WEATHER_DAILY_SIGUNGU = DATA_PROCESSED / "weather_daily_sigungu.csv"
ASOS_STATION_SIGUNGU_MAP = DATA_PROCESSED / "asos_station_sigungu_map.csv"
SIGUNGU_ASOS_STATION = DATA_PROCESSED / "sigungu_asos_station.csv"

# 분석 결과
PROVINCE_RISK = DATA_OUTPUT / "province_wildfire_risk.csv"
CITY_RISK = DATA_OUTPUT / "city_wildfire_risk.csv"
TOWN_RISK = DATA_OUTPUT / "town_wildfire_risk.csv"
WILDFIRE_ML_SUMMARY = DATA_OUTPUT / "wildfire_ml_summary.json"
WILDFIRE_DETAIL_SUMMARY = DATA_OUTPUT / "wildfire_detail_summary.json"

WILDFIRE_MOUNTAIN_CITY = DATA_OUTPUT / "wildfire_mountain_city.csv"
WILDFIRE_MOUNTAIN_TOWN = DATA_OUTPUT / "wildfire_mountain_town.csv"
WILDFIRE_MOUNTAIN_SUMMARY = DATA_OUTPUT / "wildfire_mountain_summary.json"

WILDFIRE_MOUNTAIN_EVENTS = DATA_OUTPUT / "wildfire_mountain_events.csv"
WILDFIRE_WITH_MOUNTAINS = DATA_OUTPUT / "wildfire_with_mountains.csv"
WILDFIRE_BY_MOUNTAIN = DATA_OUTPUT / "wildfire_by_mountain.csv"
WILDFIRE_MOUNTAIN_EVENTS_SUMMARY = DATA_OUTPUT / "wildfire_mountain_events_summary.json"

# XGBoost 산불 발생 예측
WILDFIRE_XGB_METRICS = DATA_OUTPUT / "wildfire_xgb_metrics.json"
SIGUNGU_ML_RISK_SCORES = DATA_OUTPUT / "sigungu_ml_risk_scores.csv"
WILDFIRE_XGB_IMPORTANCE = DATA_OUTPUT / "wildfire_xgb_feature_importance.csv"
WILDFIRE_XGB_MODEL = DATA_OUTPUT / "wildfire_xgb_model.json"
WILDFIRE_XGB_BUNDLE = DATA_OUTPUT / "wildfire_xgb_bundle.json"
SIGUNGU_HIST_STATE = DATA_PROCESSED / "sigungu_hist_state.csv"
WEATHER_RECENT_TAIL = DATA_PROCESSED / "weather_recent_tail.csv"
DAILY_ML_RISK = FRONTEND_PUBLIC_DATA / "daily_ml_risk.json"
ADMIN_SIDO_JSON = FRONTEND_PUBLIC_DATA / "admin-sido.json"
ADMIN_SIGUNGU_JSON = FRONTEND_PUBLIC_DATA / "admin-sigungu.json"
ADMIN_EMD_JSON = FRONTEND_PUBLIC_DATA / "admin-emd.json"
SIGUNGU_ML_SCORES_WEB = FRONTEND_PUBLIC_DATA / "sigungu_ml_scores.json"
MAP_DATA_JSON = FRONTEND_PUBLIC_DATA / "map-data.json"
KOREA_SIGUNGU_PATHS = FRONTEND_PUBLIC_DATA / "korea-sigungu-paths.json"

# OpenAPI 산불 통계 증분 동기화
WILDFIRE_OPENAPI_STATE = DATA_PROCESSED / "wildfire_openapi_sync_state.json"
WILDFIRE_OPENAPI_RAW = DATA_PROCESSED / "wildfire_openapi_incremental.json"


def ensure_dirs() -> None:
    for d in (DATA_RAW, DATA_PROCESSED, DATA_OUTPUT, GEO_DIR, FRONTEND_PUBLIC_DATA):
        d.mkdir(parents=True, exist_ok=True)
