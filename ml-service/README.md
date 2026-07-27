# ForestFire ML Service (Flask)

당일 산불 위험 예측 — **localhost 전용**. Express(`backend/`)만 호출하세요.

```powershell
copy .env.example .env
# KMA_API_AUTH_KEY=... 입력
pip install -r requirements.txt
python app.py
```

기본: `127.0.0.1:5000`  
로직은 `etl/ml/predict_daily_risk.py`의 `run_daily_predict`를 재사용합니다.

## 폴더 구조

```
ml-service/
├── app.py              # 진입점 (create_app · run)
├── config.py           # .env · HOST/PORT · etl path
├── routes/             # HTTP 엔드포인트
│   ├── health.py
│   ├── predict.py      # /predict/daily · scenario
│   └── sync.py         # /sync/wildfires
└── services/           # 라우트 보조 로직
    └── weather.py      # 요청 기상 파싱 · 소스 라벨
```
