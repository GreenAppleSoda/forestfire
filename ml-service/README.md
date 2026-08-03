# ForestFire ML Service (Flask)

당일·시나리오 산불 위험 예측 — **localhost 전용**. Express(`backend/`)만 호출하세요.

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
| `FOREST_FIRE_SERVICE_KEY` | 산불발생통계 OpenAPI 동기화 |
| `ML_HOST` | 기본 `127.0.0.1` |
| `ML_PORT` | 기본 `5000` |

경로·기상 클라이언트는 `etl/paths.py`, `etl/kma_asos_client.py` 를 import path에 넣어 공유합니다.

## 예측 엔진 (`predict/`)

라우트와 CLI가 같은 모듈을 씁니다.

```powershell
python -m predict.daily --kma
python -m predict.daily --date 2025-03-15
python -m predict.daily --date 2026-07-23 --temp-avg 28 --humidity-avg 45 --wind-avg 3.5 --precip 0
```

피처 (8): 기상 4 + 산불이력 2 + DWI + SPI  
학습은 `etl/ml/train_wildfire_xgb.py` (여기서 DWI/SPI 모듈을 import).

## HTTP (내부)

| 메서드 | 경로 | 설명 |
|--------|------|------|
| `GET` | `/health` | 헬스 |
| `POST` | `/predict/daily` | 당일 예측 |
| `POST` | `/predict/scenario` | 가정 기상 시나리오 예측 |
| `POST` | `/sync/wildfires` | OpenAPI 산불 이력 동기화 |
| `GET` | `/sync/wildfires/status` | 동기화 상태 |

## 폴더 구조

```
ml-service/
├── app.py                 # 진입점 (create_app · run)
├── config.py              # .env · HOST/PORT · etl path
├── requirements.txt
├── predict/               # 예측 엔진 (라우트·CLI·학습이 공유)
│   ├── daily.py           # run_daily_predict · CLI
│   ├── dwi.py             # 일기상지수
│   ├── spi.py             # 표준강수지수 시군구 매핑
│   └── scenario_weather.py
├── routes/
│   ├── health.py
│   ├── predict.py         # /predict/*
│   └── sync.py            # /sync/wildfires*
└── services/
    └── weather.py         # 요청 기상 파싱 · 소스 라벨
```

런타임 데이터·모델은 저장소 루트의 `db/` 를 읽습니다. 자세한 경로는 `etl/paths.py` 참고.
