# backend/ — 오프라인 ETL · 분석 · 학습 (웹 서버 아님)

런타임 API는 `server/`(Express) · `ml-service/`(Flask) 를 쓰세요.
여기 스크립트는 데이터 준비·모델 학습용입니다.

```
backend/
  paths.py              경로 상수
  kma_asos_client.py    기상청 ASOS 클라이언트
  requirements.txt
  _path.py              (내부) sys.path 헬퍼

  pipeline/             원본 → processed 전처리
    preprocess.py
    merge_asos_raw.py
    preprocess_weather.py
    get_mountain_data.py
    load_korea_mountains.py

  analyze/              통계·산↔산불 매칭 분석
    analyze_wildfire_*.py

  map/                  지도용 JSON 생성
    build_admin_layers.py
    export_map_data.py
    geocode_mountains_kakao.py
    build_sigungu_paths.mjs

  ml/                   학습 · CLI 예측
    train_wildfire_xgb.py
    predict_daily_risk.py   ← Flask(ml-service)가 재사용
```

## 실행 예 (프로젝트 루트)

```powershell
python backend/pipeline/preprocess.py
python backend/pipeline/merge_asos_raw.py
python backend/pipeline/preprocess_weather.py
python backend/pipeline/load_korea_mountains.py
python backend/analyze/analyze_wildfire_mountain_events.py
python backend/map/build_admin_layers.py
python backend/map/export_map_data.py
python backend/ml/train_wildfire_xgb.py
python backend/ml/predict_daily_risk.py --kma
```
