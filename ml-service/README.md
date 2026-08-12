# ForestFire ML Service (Flask)

당일·시나리오 산불 위험 예측과 산불이력(DB) 맵 갱신 — **localhost 전용**.  
Express(`backend/`)만 호출하세요.

```powershell
cd ml-service
# .env 작성 (아래 환경변수)
pip install -r requirements.txt
python app.py
```

기본: `127.0.0.1:5000`

## 환경변수 (`ml-service/.env`)

| 키 | 용도 |
|----|------|
| `KMA_API_AUTH_KEY` | 기상청 ASOS (당일 예측) |
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | MariaDB (산불 `forestfire_stats`, 기상 `weather_daily_sigungu`) |
| `ML_HOST` | 기본 `127.0.0.1` |
| `ML_PORT` | 기본 `5000` |
| `FOREST_FIRE_SERVICE_KEY` | (선택) 레거시 OpenAPI ETL 스크립트용 — 웹 동기화에는 불필요 |

예측(`predict/daily.py` 등)은 `ml_paths.py`, `predict/kma_client.py`로 `etl/` 없이도 동작합니다.  
**예외:** 이력 동기화(`routes/sync.py`)는 `etl/pipeline/sync_wildfire_history.py`를 쓰므로 `etl/` 폴더가 필요합니다.

## 예측 시 기상 출처

| 구간 | 소스 |
|------|------|
| 예측일 당일 | 기상청 ASOS API |
| lag-1 · lag-2 (어제·그저께) | MariaDB `weather_daily_sigungu` (실패 시 CSV) |

## 예측 엔진 (`predict/`)

라우트와 CLI가 같은 모듈을 씁니다.

```powershell
python -m predict.daily --kma
python -m predict.daily --date 2025-03-15
python -m predict.daily --date 2026-07-23 --temp-avg 28 --humidity-avg 45 --wind-avg 3.5 --precip 0
```

피처 (10): 기상 4 + 산불이력 2 + DWI + 강수파생 3  
(`precip_sum_7d`, `precip_sum_14d`, `dry_days` — 예측일 전일까지, 결측=0mm)  
확률: XGB raw → **Isotonic 보정**(2024 hold-out) 후 화면에 표시.  
학습은 `etl/ml/train_wildfire_xgb.py`.

## HTTP (내부)

| 메서드 | 경로 | 설명 |
|--------|------|------|
| `GET` | `/health` | 헬스 |
| `POST` | `/predict/daily` | 당일 예측 |
| `POST` | `/predict/scenario` | 가정 기상 시나리오 예측 |
| `POST` | `/sync/wildfires` | MariaDB 산불 이력 → 맵 JSON 갱신 |
| `GET` | `/sync/wildfires/status` | 동기화 상태 |

## 폴더 구조

```
ml-service/
├── app.py
├── config.py              # .env · HOST/PORT · etl path (동기화용)
├── ml_paths.py            # 예측용 경로
├── requirements.txt
├── predict/
│   ├── daily.py
│   ├── weather_db.py      # MariaDB lag/학습 기상
│   ├── fire_db.py         # MariaDB forestfire_stats
│   ├── dwi.py · precip_features.py · calibration.py
│   ├── kma_client.py
│   └── scenario_weather.py
├── routes/
│   ├── health.py
│   ├── predict.py
│   └── sync.py            # → etl sync_wildfire_history
└── services/
    └── weather.py
```

런타임 모델·hist 등은 저장소 루트 `db/` 를 읽습니다.
