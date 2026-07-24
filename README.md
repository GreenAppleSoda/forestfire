# South Korea Wildfire Atlas (산불맵)

산불·산 정보 분석 파이프라인과 Next.js 산불맵.

## 폴더 구조

```
frontend/     Next.js UI (산불맵) · public/data 에 지도용 JSON
backend/      Python ETL · ML · 기상 API · 예측 스크립트
db/           파일 기반 데이터 저장소
  raw/          원본 (산불·ASOS·산 목록·행정 shapefile)
  processed/    전처리·지오코딩·학습용 중간 산출물
  output/       분석·모델·지표
docs/         참고 문서
```

## 프론트엔드 실행

```bash
cd frontend
npm install
npm run dev
```

환경변수: `frontend/.env.local`  
(`KMA_API_AUTH_KEY`, `KAKAO_REST_API_KEY`)

## 백엔드 파이프라인 (예시)

프로젝트 루트에서:

```bash
python backend/preprocess.py
python backend/merge_asos_raw.py
python backend/preprocess_weather.py
python backend/load_korea_mountains.py
python backend/analyze_wildfire_mountain_events.py
python backend/build_admin_layers.py
python backend/export_map_data.py
python backend/train_wildfire_xgb.py
python backend/predict_daily_risk.py --kma
```

경로 상수는 `backend/paths.py` 한곳에서 관리합니다.
