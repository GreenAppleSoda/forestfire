# ForestFire ML Service (Flask)

당일 산불 위험 예측 — **localhost 전용**. Express만 호출하세요.

```powershell
copy .env.example .env
# KMA_API_AUTH_KEY=... 입력
pip install -r requirements.txt
python app.py
```

기본: `127.0.0.1:5000`  
로직은 `backend/ml/predict_daily_risk.py`의 `run_daily_predict`를 재사용합니다.
