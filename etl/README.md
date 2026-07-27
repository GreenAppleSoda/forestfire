# etl/ — 오프라인 ETL · 분석 · 학습 (웹 서버 아님)

런타임 API는 `backend/`(Express) · `ml-service/`(Flask) 를 쓰세요.

```
etl/
├── paths.py           # 경로 상수 (단일 출처)
├── pipeline/          # 전처리 · OpenAPI 동기화
├── analyze/           # 통계 · 산-산불 매칭
├── map/               # 행정구역·지도 JSON 생성
└── ml/                # XGBoost 학습 · CLI 예측
```

## 자주 쓰는 명령

```powershell
python etl/pipeline/preprocess.py
python etl/pipeline/merge_asos_raw.py
python etl/pipeline/preprocess_weather.py
python etl/pipeline/load_korea_mountains.py
python etl/analyze/analyze_wildfire_mountain_events.py
python etl/map/build_admin_layers.py
python etl/map/export_map_data.py
python etl/ml/train_wildfire_xgb.py
python etl/ml/predict_daily_risk.py --kma
```

산불 OpenAPI 증분:

```powershell
python etl/pipeline/sync_wildfire_openapi.py --days 120
```
