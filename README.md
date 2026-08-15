# South Korea Wildfire Atlas (산불맵)

산불·산 정보 분석 파이프라인과 Next.js 산불맵.  
지도·예측에 더해 **회원 로그인**, **Gemini 안내 챗봇**, **지역별 PDF 보고서**(회원 전용)를 제공합니다.

## 런타임 구조 (역할 분리)

| 프로세스 | 폴더 | 포트 | 역할 |
|----------|------|------|------|
| Next.js | `frontend/` | 3000 | UI · `/api` → Express 프록시 · 챗봇·로그인·보고서 모달 |
| Express | `backend/` | 4000 | 공개 API · 회원/세션 · 챗봇 · 보고서 게이트 · Flask 프록시 · DTO 화이트리스트 |
| Flask | `ml-service/` | 5000 | 예측 · 산불이력(DB) 동기화 · PDF 렌더(Playwright) · localhost 전용 |
| 배치 ETL | `etl/` | — | 전처리·학습 스크립트 (웹 요청에서 실행하지 않음) |

```
브라우저 → Next(:3000) ─Route Handler─→ Express(:4000) → Flask(:5000)
                                    ↘ map JSON · Gemini · 회원 DB
```

`/api/*` 는 `frontend/src/app/api/[...path]/route.ts` 가 Express로 넘깁니다.  
브라우저에는 Express가 필터한 DTO만 전달됩니다. 파이썬 stdout·모델 경로·API 키는 응답에 포함되지 않습니다.

**PDF 보고서:** 회원 세션 확인(Express) → `ml-service` Jinja2+Playwright로 PDF 생성 → 임시 다운로드 URL 발급.

## 데이터 소스 (현재)

| 용도 | 우선 소스 | 비고 |
|------|-----------|------|
| 산불 이력 (맵 갱신·학습·분석) | MariaDB `forestfire_stats` | 실패 시 `refined_wildfire_data.csv` 폴백 |
| 예측용 당일 기상 | 기상청 ASOS API | `KMA_API_AUTH_KEY` |
| 예측용 lag 기상 (어제·그저께) | MariaDB `weather_daily_sigungu` | 실패 시 CSV 폴백 |
| 학습용 기상 | MariaDB 우선 | 동일 테이블 / CSV 폴백 |
| 지도 JSON | `frontend/public/data` + `backend/data` | etl·이력 갱신 시 둘 다 동기화 |
| 챗봇·리포트용 당일 예측 스냅샷 | `backend/data/daily_ml_risk.json` | 예측 시 `frontend/public/data`와 이중 저장. 챗봇은 예측 API 우선, 실패 시 파일 폴백 |

`refined_wildfire_data.csv` 는 더 이상 주 데이터가 아닙니다. DB가 정상이면 없어도 일상 운영(예측·이력 갱신·학습)이 가능합니다.

회원/비회원은 **로그인 세션 유무**로만 구분합니다. 구독·결제 테이블은 사용하지 않습니다.

## 폴더 구조

```
ForestFire/
├── frontend/          Next.js UI (:3000)
│   └── src/           app · components · lib · app/api/[...path] 프록시
├── backend/           Express 공개 API (:4000, TypeScript)
│   ├── data/          지도·daily_ml_risk JSON 사본
│   ├── migrations/    챗봇 세션 등 SQL
│   └── src/
├── ml-service/        Flask (:5000, localhost)
│   ├── predict/       예측 엔진 + weather_db · fire_db (MariaDB)
│   ├── report/        지역별 PDF (Jinja2 + Playwright)
│   └── routes/        health · predict · report · sync
├── etl/               오프라인 ETL · 분석 · 학습
├── db/                서버 배포용 (모델·hist_state 등)
├── db-archive/        ETL·분석 원본·중간 산출물
└── docs/
```

## 웹 앱 실행 (3개 프로세스)

PowerShell — 터미널을 세 개 엽니다. **Flask → Express → Next** 순을 권장합니다.

### 1) Flask (`ml-service`)

```powershell
cd ml-service
# .env 에 KMA_API_AUTH_KEY · DB_* 입력 (아래 표 참고)
pip install -r requirements.txt
playwright install chromium   # PDF 보고서용 — 1회
python app.py
```

Linux 배포 시 Chromium 시스템 의존성·한글 폰트는 `ml-service/README.md` 참고.

### 2) Express (`backend`)

```powershell
cd backend
# .env 에 FRONTEND_ORIGIN · ML_SERVICE_URL · GEMINI_API_KEY · DB_* · SESSION_SECRET 등 입력
npm install
npm run dev
```

### 3) Next.js (`frontend`)

```powershell
cd frontend
# .env.local 에 NEXT_PUBLIC_KAKAO_MAP_KEY · EXPRESS_URL 입력
npm install
npm run dev
```

브라우저: http://localhost:3000  
헬스: http://localhost:4000/api/health

## 환경변수

| 위치 | 키 | 용도 |
|------|-----|------|
| `ml-service/.env` | `KMA_API_AUTH_KEY` | 기상청 ASOS (당일 예측) |
| `ml-service/.env` | `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | MariaDB (산불·lag 기상) |
| `ml-service/.env` | `ML_HOST`, `ML_PORT` | 바인딩 (기본 `127.0.0.1:5000`) |
| `ml-service/.env` | `FOREST_FIRE_SERVICE_KEY` | (선택) 레거시 OpenAPI 스크립트용 |
| `backend/.env` | `PORT`, `FRONTEND_ORIGIN`, `ML_SERVICE_URL`, `PREDICT_CACHE_MS`, `DATA_DIR` | CORS · Flask URL · 예측 캐시 · 지도 데이터 폴더 |
| `backend/.env` | `GEMINI_API_KEY`, `GEMINI_MODEL`(선택) | 안내 챗봇 (`/api/chat`) |
| `backend/.env` | `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | 회원·챗봇 세션 (ml-service 와 동일 MariaDB 권장) |
| `backend/.env` | `SESSION_SECRET`, `SESSION_DAYS`(선택) | 로그인 세션 쿠키 서명 |
| `frontend/.env.local` | `NEXT_PUBLIC_KAKAO_MAP_KEY`, `EXPRESS_URL` | 카카오 JS 키 · Express 주소 (`http://127.0.0.1:4000` 권장) |

카카오 개발자 콘솔에서 **JavaScript 키**를 쓰고, Web 플랫폼에 `http://localhost:3000` 을 등록해야 위성 지도가 표시됩니다.

`KMA_API_AUTH_KEY` / `DB_*` / `FOREST_FIRE_SERVICE_KEY` / `GEMINI_API_KEY` / `SESSION_SECRET` 는 프론트 `.env.local`에 두지 마세요.

### backend와 frontend가 지도 데이터를 나눠 갖는 이유

`frontend`와 `backend`는 지도 JSON(`map-data.json`, `admin-*.json`)을 각자 폴더에 **따로** 둡니다.

- `frontend/public/data` — 브라우저가 정적 파일로 직접 로드
- `backend/data` — Express `/api/map/*` · 챗봇 폴백 · 리포트 입력이 읽는 사본

원본은 `etl`이 만듭니다. `frontend/public/data`를 갱신할 때마다
`etl/paths.py`의 `sync_backend_data()`가 `backend/data`로도 복사합니다.
웹 **산불이력 갱신**(`POST /api/wildfires/sync`)도 `refresh_history_layers()` 안에서 같이 복사합니다.

당일 예측(`predict.daily`)은 `daily_ml_risk.json`을 **frontend·backend data 양쪽에** 씁니다.

## 회원 · 챗봇 · 보고서 (요약)

| 기능 | 비회원 | 회원(로그인) |
|------|--------|----------------|
| 지도 · 당일/시나리오 예측 · 챗봇 Q&A | ✅ | ✅ |
| PDF 보고서 생성·다운로드 | ❌ | ✅ |
| 챗봇 대화 DB 저장 | DB 설정 시 게스트 세션 | `user_id`로 묶여 기기 무관 이어짐 |

- 챗봇: 예측 API(`runPredictDaily`) 우선 → 실패 시 `backend/data/daily_ml_risk.json`
- 로그인 회원은 최근 대화를 `user_id` 기준으로 불러와 Gemini·UI에 복원 (게스트는 `sessionId`)
- 「보고서 만들어줘」류 요청 / UI 보고서 버튼 → Express가 회원 확인 후 Flask `POST /report/pdf` 호출
- 보고서는 DB에 저장하지 않고, 생성 후 짧은 TTL로 다운로드만 제공합니다

자세한 API·폴더 구조는 `backend/README.md` · `frontend/README.md` · `ml-service/README.md` 참고.

## 예측 모델 (요약)

시군구×일 산불 발생 확률 — XGBoost.

**피처 (10):** `temp_avg`, `precip`, `wind_avg`, `humidity_avg`, `hist_fire_rate`, `hist_fire_count_365`, `dwi`, `precip_sum_7d`, `precip_sum_14d`, `dry_days`

| 단계 | 위치 |
|------|------|
| 학습 | `etl/ml/train_wildfire_xgb.py` (기상·산불: MariaDB 우선) |
| 추론 | `ml-service/predict/daily.py` |
| 산출물 | `db/output/wildfire_xgb_*.json`, `db/processed/sigungu_hist_state.csv` 등 |

CLI 예측:

```powershell
cd ml-service
python -m predict.daily --kma
```

## 산불 이력 갱신 (MariaDB)

MariaDB `forestfire_stats` → `admin-*.json` / `map-data.json` 이력 색·건수 갱신.

```powershell
python etl/pipeline/sync_wildfire_history.py
```

웹: **이력 기반** 탭 → 「산불이력 갱신」  
API: `POST /api/wildfires/sync` (Express → Flask → 위 파이프라인)

(참고) 예전 공공데이터 OpenAPI 증분 스크립트는 `etl/pipeline/sync_wildfire_openapi.py` 에 남아 있으나, **웹 버튼·기본 동기화 경로는 DB**입니다.

## Express API (공개)

**맵 · 예측 · 동기화**

- `GET /api/health`
- `GET /api/map/data`
- `GET /api/map/admin/:level` (`sido` \| `sigungu` \| `emd`)
- `POST /api/predict/daily` — body: `{ source, force, date?, weather? }`
- `POST /api/predict/scenario` — body: `{ year, month, weather: { temp_avg, humidity_avg, wind_avg, precip } }`
- `POST /api/wildfires/sync` — MariaDB 산불 이력 → 맵 갱신
- `GET /api/wildfires/sync/status`

**회원**

- `POST /api/auth/register` · `POST /api/auth/login` · `POST /api/auth/logout`
- `GET /api/auth/me`

**챗봇 · 보고서**

- `POST /api/chat` — body: `{ message, sessionId? }` (비로그인 가능; 보고서 요청은 회원; 회원은 user 기준 히스토리)
- `GET /api/chat/history` — 최근 대화 복원 (회원=`user_id`, 게스트=`sessionId`)
- `GET /api/report/daily` — JSON 요약 (**회원**)
- `POST /api/report/pdf` — body: `{ regionQuery? }` → 다운로드 메타 (**회원**)
- `GET /api/report/download/:id` — PDF 바이너리 (**회원**, 임시)

## Flask API (내부)

- `GET /health`
- `POST /predict/daily` — Express만 호출
- `POST /predict/scenario` — Express만 호출
- `POST /report/pdf` — body: `{ region }` — Express만 호출 (PDF 바이트)
- `POST /sync/wildfires` — MariaDB 이력 동기화
- `GET /sync/wildfires/status`

## 배치 파이프라인 (오프라인)

자세한 설명은 `etl/README.md` 참고.

```powershell
python etl/pipeline/preprocess.py
python etl/pipeline/preprocess_weather.py
python etl/pipeline/load_korea_mountains.py
python etl/analyze/analyze_wildfire_mountain_events.py
python etl/map/build_admin_layers.py
python etl/map/export_map_data.py
python etl/ml/train_wildfire_xgb.py
cd ml-service; python -m predict.daily --kma
```

경로 상수는 `etl/paths.py` 한곳에서 관리합니다.  
산불 원본 로드는 `etl/pipeline/load_wildfire_history.py` (DB 우선)를 공통으로 씁니다.
