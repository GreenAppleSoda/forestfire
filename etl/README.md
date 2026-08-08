# etl/ — 오프라인 ETL · 분석 · 학습 (웹 서버 아님)

런타임 API는 `backend/`(Express) · `ml-service/`(Flask) 를 쓰세요.

**예측 엔진은 `ml-service/predict/` 에 있습니다.**  
이 폴더의 `ml/` 에는 XGBoost **학습** 스크립트만 둡니다.

## 데이터 경로 (`paths.py`)

| 루트 | 용도 |
|------|------|
| `db/` | 서버 배포용 예측 런타임 (weather · hist · spi · model) |
| `db-archive/` | 원본·중간 산출물·학습 메트릭·분석 CSV |
| `frontend/public/data/` | 지도·점수 JSON (웹 정적 파일) → `backend/data`에도 동기화 |

주요 런타임 파일 (`db/`):

- `processed/weather_daily_sigungu.csv` (폴백 — 학습·lag는 MariaDB 우선)
- `processed/sigungu_hist_state.csv`
- `processed/spi_daily_sigungu.csv`
- `processed/sigungu_asos_station.csv`
- `output/wildfire_xgb_model.json`
- `output/wildfire_xgb_bundle.json`

산불 원본: MariaDB `forestfire_stats` 우선.  
공통 로더: `pipeline/load_wildfire_history.py` (실패 시 `db-archive/processed/refined_wildfire_data.csv`).

## 폴더 구조

```
etl/
├── paths.py
├── requirements.txt
├── pipeline/
│   ├── load_wildfire_history.py   # DB 우선 산불 로드
│   ├── sync_wildfire_history.py   # DB → 맵 갱신 (웹 동기화와 동일)
│   ├── sync_wildfire_openapi.py   # 레거시 OpenAPI 증분
│   ├── preprocess.py · preprocess_weather.py · …
├── analyze/
├── map/                  # build_admin_layers · export_map_data · refresh_history_layers
└── ml/
    └── train_wildfire_xgb.py
```

학습 스크립트는 `ml-service/` 를 path에 넣고 `predict.dwi` / `predict.spi` / `predict.weather_db` 등을 사용합니다.

## 모델 피처 (학습·추론 공통)

`temp_avg`, `precip`, `wind_avg`, `humidity_avg`,  
`hist_fire_rate`, `hist_fire_count_365`, `dwi`, `spi`

검증 분할: train ~2024-12-31 / test 2025-01-01~

## 자주 쓰는 명령

저장소 루트에서:

```powershell
pip install -r etl/requirements.txt

python etl/pipeline/preprocess.py
python etl/pipeline/preprocess_weather.py
python etl/pipeline/load_korea_mountains.py
python etl/analyze/analyze_wildfire_mountain_events.py
python etl/map/build_admin_layers.py
python etl/map/export_map_data.py
python etl/ml/train_wildfire_xgb.py
```

당일 예측 CLI (엔진은 ml-service):

```powershell
cd ml-service
pip install -r requirements.txt
python -m predict.daily --kma
```

산불 이력 → 맵 갱신 (MariaDB, 웹 「산불이력 갱신」과 동일):

```powershell
python etl/pipeline/sync_wildfire_history.py
```

(레거시) 공공데이터 OpenAPI 증분:

```powershell
python etl/pipeline/sync_wildfire_openapi.py --days 120
```
