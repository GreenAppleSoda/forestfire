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

import shutil
from pathlib import Path

# ForestFire/ (프로젝트 루트)
ROOT = Path(__file__).resolve().parent.parent

ETL = ROOT / "etl"
FRONTEND = ROOT / "frontend"
FRONTEND_PUBLIC_DATA = FRONTEND / "public" / "data"
FRONTEND_ENV_LOCAL = FRONTEND / ".env.local"
ML_SERVICE_ENV = ROOT / "ml-service" / ".env"

# backend가 자기 폴더 안에서 읽을 수 있도록 지도 JSON을 복사해 두는 위치.
# backend는 frontend 폴더를 직접 읽지 않고 이 사본(backend/data)을 읽는다.
BACKEND_DATA = ROOT / "backend" / "data"
WEB_MIRROR_FILES = (
    "map-data.json",
    "admin-sido.json",
    "admin-sigungu.json",
    "admin-emd.json",
)

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
MOUNTAIN_IMAGES_META = DATA_PROCESSED_ETL / "mountain_images.json"
MOUNTAIN_IMAGES_DIR = FRONTEND_PUBLIC_DATA / "mountain-images"
MOUNTAIN_IMAGES_PUBLIC_PREFIX = "/data/mountain-images"

# 기상 (ASOS)
RAW_ASOS_DAILY = DATA_RAW / "weather" / "asos_daily_2011_2026.csv"
ASOS_STATION_SIGUNGU_MAP = DATA_PROCESSED_ETL / "asos_station_sigungu_map.csv"
# 예측 런타임에 필요 → db/
WEATHER_DAILY_SIGUNGU = DATA_PROCESSED / "weather_daily_sigungu.csv"
WEATHER_DAILY_ASOS = DATA_PROCESSED_ETL / "weather_daily_asos.csv"
SIGUNGU_ASOS_STATION = DATA_PROCESSED / "sigungu_asos_station.csv"

# 분석 결과 (archive)
CITY_RISK = DATA_OUTPUT_ETL / "city_wildfire_risk.csv"

WILDFIRE_MOUNTAIN_EVENTS = DATA_OUTPUT_ETL / "wildfire_mountain_events.csv"
WILDFIRE_WITH_MOUNTAINS = DATA_OUTPUT_ETL / "wildfire_with_mountains.csv"
WILDFIRE_BY_MOUNTAIN = DATA_OUTPUT_ETL / "wildfire_by_mountain.csv"
WILDFIRE_MOUNTAIN_EVENTS_SUMMARY = DATA_OUTPUT_ETL / "wildfire_mountain_events_summary.json"

# XGBoost — 모델·번들은 서버용 db/, 학습 로그는 archive
ML_TRAIN_SIGUNGU_DAILY_1Y = DATA_PROCESSED_ETL / "ml_train_sigungu_daily_1y.csv"
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
        BACKEND_DATA,
        MOUNTAIN_IMAGES_DIR,
    ):
        d.mkdir(parents=True, exist_ok=True)


def sync_backend_data() -> None:
    """지도 JSON(WEB_MIRROR_FILES)을 frontend/public/data → backend/data로 복사.

    backend는 이 사본을 읽으므로(backend/.env의 DATA_DIR), frontend/public/data를
    갱신하는 스크립트(build_admin_layers · export_map_data · compress_web_data ·
    refresh_history_layers)는 마지막에 이 함수를 호출해 backend도 최신 상태로 맞춘다.
    """
    BACKEND_DATA.mkdir(parents=True, exist_ok=True)
    for name in WEB_MIRROR_FILES:
        src = FRONTEND_PUBLIC_DATA / name
        if src.exists():
            shutil.copy2(src, BACKEND_DATA / name)
