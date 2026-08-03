# etl/ — 오프라인 ETL · 분석 · 학습 (웹 서버 아님)

런타임 API는 `backend/`(Express) · `ml-service/`(Flask) 를 쓰세요.

**예측 엔진(당일·DWI·SPI·시나리오)은 `ml-service/predict/` 에 있습니다.**  
이 폴더의 `ml/` 에는 XGBoost **학습** 스크립트만 둡니다.

## 데이터 경로 (`paths.py`)

| 루트 | 용도 |
|------|------|
| `db/` | 서버 배포용 예측 런타임 (weather · hist · spi · model) |
| `db-archive/` | 원본·중간 산출물·학습 메트릭·분석 CSV |
| `frontend/public/data/` | 지도·점수 JSON (웹 정적 파일) |

주요 런타임 파일 (`db/`):

- `processed/weather_daily_sigungu.csv`
- `processed/sigungu_hist_state.csv`
- `processed/spi_daily_sigungu.csv`
- `processed/sigungu_asos_station.csv`
- `output/wildfire_xgb_model.json`
- `output/wildfire_xgb_bundle.json`

SPI 원본은 `db-archive/raw/spi/daily_spi_1991~2026.csv` → 학습/예측 시 시군구 매핑본으로 빌드합니다.

## 폴더 구조

```
etl/
├── paths.py              # 경로 상수 (단일 출처)
├── kma_asos_client.py    # 기상청 ASOS 클라이언트 (ml-service와 공유)
├── requirements.txt
├── pipeline/             # 전처리 · OpenAPI 동기화
├── analyze/              # 통계 · 산-산불 매칭
│   └── analyze_wildfire_mountain_events.py
├── map/                  # 행정구역·지도 JSON 생성
└── ml/
    └── train_wildfire_xgb.py   # 학습만 (predict.dwi / predict.spi import)
```

학습 스크립트는 `ml-service/` 를 `sys.path`에 넣고 `from predict.dwi` · `from predict.spi` 를 사용합니다.

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

산불 OpenAPI 증분:

```powershell
python etl/pipeline/sync_wildfire_openapi.py --days 120
```

웹 UI 또는 `POST /api/wildfires/sync` (Express → Flask)로도 동일 파이프라인을 돌릴 수 있습니다.
