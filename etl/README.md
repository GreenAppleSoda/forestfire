# etl/ — 오프라인 ETL · 분석 · 학습 (웹 서버 아님)

런타임 API는 `backend/`(Express) · `ml-service/`(Flask) 를 쓰세요.

**예측 엔진은 `ml-service/predict/` 에 있습니다.**  
이 폴더의 `ml/` 에는 XGBoost **학습** 스크립트만 둡니다.

## 데이터 경로 (`paths.py`)

| 루트 | 용도 |
|------|------|
| `ml-service/models/` | XGBoost 모델 JSON (예측 런타임) |
| `ml-service/reference/` | 시군구 hist · ASOS 매핑 CSV (예측 런타임) |
| `db/` | 로컬 대용량 CSV (Git 제외, weather 폴백) |
| `db-archive/` | 원본·중간 산출물·학습 메트릭·분석 CSV · 산 이미지 메타 |
| `frontend/public/data/` | 지도·점수 JSON · 법정동 lookup · 산 이미지. `paths.sync_backend_data()`가 지도 JSON을 `backend/data`로 복사 |

주요 런타임 파일:

- `ml-service/models/wildfire_xgb_model.json`
- `ml-service/models/wildfire_xgb_bundle.json`
- `ml-service/reference/sigungu_hist_state.csv`
- `ml-service/reference/sigungu_asos_station.csv`
- `db/processed/weather_daily_sigungu.csv` (폴백 — 학습·lag는 MariaDB 우선)
- `frontend/public/data/mountain-images/{산코드}.jpg` (웹 정적, Git 제외)
- `db-archive/processed/mountain_images.json` (수집 메타)
- `frontend/public/data/legal-dong-lookup.json`

산불 원본: MariaDB `forestfire_stats` 우선.  
공통 로더: `pipeline/load_wildfire_history.py` (실패 시 `db-archive/processed/refined_wildfire_data.csv`).

`sync_backend_data()`가 복사하는 파일: `map-data.json`, `admin-sido.json`, `admin-sigungu.json`, `admin-emd.json`.  
산 이미지·법정동 lookup은 frontend 정적 경로에 둡니다.

## 폴더 구조

```
etl/
├── paths.py
├── requirements.txt
├── kma_asos_client.py
├── mountain_crawlling.py          # 산림청 산정보 목록(원본 JSON)
├── pipeline/
│   ├── load_wildfire_history.py   # DB 우선 산불 로드
│   ├── sync_wildfire_history.py   # DB → frontend/public/data 맵 갱신 (오프라인 CLI)
│   ├── sync_wildfire_openapi.py   # 레거시 OpenAPI 증분
│   ├── fetch_mountain_images.py   # 산 썸네일 → public/data/mountain-images
│   ├── build_legal_dong_lookup.py # 법정동코드 → legal-dong-lookup.json
│   ├── normalize_region_names.py
│   ├── load_korea_mountains.py
│   ├── preprocess.py · preprocess_weather.py · …
├── analyze/
├── map/
│   ├── build_admin_layers.py
│   ├── export_map_data.py         # map-data.json (+ image_url)
│   ├── compress_web_data.py
│   ├── geocode_mountains_kakao.py
│   └── refresh_history_layers.py
└── ml/
    └── train_wildfire_xgb.py
```

학습 스크립트는 `ml-service/` 를 path에 넣고 `predict.dwi` / `predict.weather_db` 등을 사용합니다.

## 모델 피처 (학습·추론 공통)

`temp_avg`, `precip`, `wind_avg`, `humidity_avg`,  
`hist_fire_rate`, `hist_fire_count_365`, `dwi`,  
`precip_sum_7d`, `precip_sum_14d`, `dry_days`

검증 분할: train ~2024-12-31 / test 2025-01-01~

## 자주 쓰는 명령

저장소 루트에서:

```powershell
pip install -r etl/requirements.txt

python etl/pipeline/preprocess.py
python etl/pipeline/preprocess_weather.py
python etl/pipeline/load_korea_mountains.py
python etl/pipeline/build_legal_dong_lookup.py
python etl/analyze/analyze_wildfire_mountain_events.py
python etl/map/build_admin_layers.py
python etl/map/export_map_data.py
python etl/pipeline/fetch_mountain_images.py
python etl/map/compress_web_data.py
python etl/ml/train_wildfire_xgb.py
```

산 이미지·산정보 수집은 `requests` · `python-dotenv` 가 필요합니다(`etl/requirements.txt`에 없으면 별도 설치).

당일 예측 CLI (엔진은 ml-service):

```powershell
cd ml-service
pip install -r requirements.txt
python -m predict.daily --kma
```

산불 이력 → 맵 갱신 (MariaDB). 웹 버튼(`POST /api/wildfires/sync`)은 `backend/data`만 패치합니다.  
이 CLI는 `frontend/public/data`를 갱신한 뒤 `sync_backend_data()`로 `backend/data`에도 복사합니다.

```powershell
python etl/pipeline/sync_wildfire_history.py
```

(레거시) 공공데이터 OpenAPI 증분:

```powershell
python etl/pipeline/sync_wildfire_openapi.py --days 120
```

## 산 이미지 (`pipeline/fetch_mountain_images.py`)

산림청 `mntInfoImgOpenAPI2`로 이미지를 받아 `frontend/public/data/mountain-images/`에 저장하고, `map-data.json`의 산 객체에 `image_url`을 붙입니다. 웹 런타임에서는 OpenAPI를 호출하지 않습니다. 이미 받은 산은 건너뜁니다.

```powershell
# etl/.env 또는 루트 .env 에 FOREST_MOUNTAIN_SERVICE_KEY
python etl/pipeline/fetch_mountain_images.py
python etl/pipeline/fetch_mountain_images.py --limit 20          # 테스트
python etl/pipeline/fetch_mountain_images.py --catalog-only      # 산도감·연계 산만
python etl/pipeline/fetch_mountain_images.py --force             # 재조회
```

`export_map_data.py`도 같은 메타에서 `image_url`을 넣습니다. 끝난 뒤 `sync_backend_data()`로 지도 JSON만 backend에 복사합니다(이미지 파일은 frontend 정적).

## 법정동 lookup (`pipeline/build_legal_dong_lookup.py`)

입력: `db-archive/raw/legal_dong_codes.txt` 또는 루트의 `법정동코드 전체자료.txt` (CP949).  
출력: `db-archive/processed/legal_dong_lookup.json` · `frontend/public/data/legal-dong-lookup.json`.

프론트 이력·최근 산불 피드의 지역명 정규화, Express `lib/regionPath.ts`의 이력 경로 정규화에 쓰입니다.

## 산 지오코딩 (`map/geocode_mountains_kakao.py`)

산 주소 → 카카오 로컬 → 위경도·SVG 좌표. `KAKAO_REST_API_KEY` (ml-service/.env 또는 frontend/.env.local).
