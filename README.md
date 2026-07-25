# South Korea Wildfire Atlas (산불맵)

산불·산 정보 분석 파이프라인과 Next.js 산불맵.

## 런타임 구조 (역할 분리)

| 프로세스 | 폴더 | 포트 | 역할 |
|----------|------|------|------|
| Next.js | `frontend/` | 3000 | UI만 |
| Express | `server/` | 4000 | 공개 API · Flask 프록시 · 응답 화이트리스트 |
| Flask | `ml-service/` | 5000 | 당일 예측 계산 (localhost 전용) |
| 배치 ETL | `backend/` | — | 전처리·학습 스크립트 (웹 요청에서 실행하지 않음) |

```
브라우저 → Next(:3000) ─rewrite─→ Express(:4000) → Flask(:5000)
                              ↘ map/mountains JSON
```

브라우저에는 Express가 필터한 DTO만 전달됩니다. 파이썬 stdout·모델 경로·API 키는 응답에 포함되지 않습니다.

## 폴더 구조

```
ForestFire/
├── frontend/          Next.js UI (:3000)
│   └── src/           components, app, lib
├── server/            Express 공개 API (:4000)
│   └── src/index.js
├── ml-service/        Flask 예측 (:5000, localhost)
│   └── app.py
├── backend/           오프라인 ETL · 분석 · 학습 (웹 아님)
│   ├── pipeline/      전처리
│   ├── analyze/       통계·매칭
│   ├── map/           지도 JSON 생성
│   └── ml/            XGBoost 학습·CLI 예측
├── db/                파일 데이터 저장소
│   ├── raw/
│   ├── processed/
│   └── output/
└── docs/              참고 문서
```

## 웹 앱 실행 (3개 프로세스)

PowerShell — 터미널을 세 개 엽니다.

### 1) Flask (`ml-service`)

```powershell
cd ml-service
copy .env.example .env
# .env 에 KMA_API_AUTH_KEY=... 입력
pip install -r requirements.txt
python app.py
```

### 2) Express (`server`)

```powershell
cd server
copy .env.example .env
npm install
npm run dev
```

### 3) Next.js (`frontend`)

```powershell
cd frontend
npm install
npm run dev
```

브라우저: http://localhost:3000  
헬스: http://localhost:4000/api/health

## 환경변수

| 위치 | 키 | 용도 |
|------|-----|------|
| `ml-service/.env` | `KMA_API_AUTH_KEY` | 기상청 API (서버 전용) |
| `server/.env` | `FRONTEND_ORIGIN`, `ML_SERVICE_URL` | CORS · Flask URL |
| `frontend/.env.local` | `NEXT_PUBLIC_KAKAO_MAP_KEY`, `EXPRESS_URL` | 카카오 지도 JS 키 · Express 주소 |

`frontend/.env.local.example` 을 복사해 `.env.local` 을 만들고 키를 넣으세요.  
카카오 개발자 콘솔에서 **JavaScript 키**를 쓰고, Web 플랫폼에 `http://localhost:3000` 을 등록해야 위성 지도가 표시됩니다.

`KMA_API_AUTH_KEY` / `KAKAO_REST_API_KEY` 는 프론트 `.env.local`에 두지 마세요.

## Express API (공개)

- `GET /api/health`
- `GET /api/map/data`
- `GET /api/map/admin/:level` (`sido` \| `sigungu` \| `emd`)
- `GET /api/map/ml-scores`
- `GET /api/map/daily-risk`
- `GET /api/mountains?q=`
- `POST /api/predict/daily` — body: `{ source, force, date?, weather? }`
- `GET /api/predict/scenario/defaults?year=&month=`
- `POST /api/predict/scenario` — body: `{ year, month, weather: { temp_avg, humidity_avg, wind_avg, precip } }`

## Flask API (내부)

- `GET /health`
- `POST /predict/daily` — Express만 호출
- `GET /predict/scenario/defaults`
- `POST /predict/scenario` — Express만 호출

## 배치 파이프라인 (오프라인)

자세한 설명은 `backend/README.md` 참고.

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

경로 상수는 `backend/paths.py` 한곳에서 관리합니다.
