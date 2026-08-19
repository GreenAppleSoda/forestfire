# FORESTFIRE ATLAS KOREA

South Korea Wildfire Atlas — 시군구 산불 위험 지도·예측 웹서비스.

지도·당일/시나리오 예측에 더해 **회원 로그인**(로컬 아이디 + 구글/카카오 OAuth), **Gemini 안내 챗봇**, **지역별 PDF 보고서**(회원 전용)를 제공합니다.  
화면에 보이는 당일·시나리오 값은 XGBoost `predict_proba` raw 확률(`ml_risk`)을 ×100 한 **산불위험지수 (0~100)** 입니다.

## 주요 화면

- 좌측: FORESTFIRE ATLAS KOREA 브랜드, 지역·산 통합 검색, 위험 표시(당일 예측 / 사용자 지정 / 과거 이력), 최근 산불 발생 피드
- 지도: SVG 행정구역 + 카카오 위성, 범례는 우측 하단에 산불위험지수 0~100
- 우측: 전체 산불 건수·갱신 날짜·갱신 버튼, 지역 미선택 시 전국 평균·최고 위험 시도 요약 → 선택 시 이력·산 상세
- 사용자 지정: 접속월부터 12개월만 선택(기본값 다음 달). API는 `year`/`month` 그대로 전달
- 기상 카드: 선택 지역이 있으면 해당 시군구(또는 시도 평균) 기상

## 런타임 구조 (역할 분리)

| 프로세스 | 폴더 | 포트 | 역할 |
|----------|------|------|------|
| Next.js | `frontend/` | 3000 | UI · `/api` → Express 프록시 · 챗봇·로그인·보고서 모달 |
| Express | `backend/` | 4000 | 공개 API · 회원/세션 · 챗봇 · 산불이력 맵 갱신 · 보고서 게이트 · Flask 프록시 · DTO 화이트리스트 |
| Flask | `ml-service/` | 5000 | 예측 · PDF 렌더(Playwright) · localhost 전용 |
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
| 지도 JSON | `frontend/public/data` + `backend/data` | 첫 로딩은 프론트 정적 파일. 웹 이력 갱신은 `backend/data`만 패치 |
| 챗봇·리포트용 당일 예측 스냅샷 | `backend/data/daily_ml_risk.json` | Express가 예측 API 성공 시 저장. 챗봇은 예측 API 우선, 실패 시 파일 폴백 |

`refined_wildfire_data.csv` 는 더 이상 주 데이터가 아닙니다. DB가 정상이면 없어도 일상 운영(예측·이력 갱신·학습)이 가능합니다.

회원/비회원은 **로그인 세션 유무**로만 구분합니다. 구독·결제 테이블은 사용하지 않습니다.  
로그인은 로컬(아이디/비밀번호) + 구글/카카오 OAuth를 지원하며, 유휴 30분 후 자동 로그아웃됩니다(연장 가능).

## 폴더 구조

```
ForestFire/
├── frontend/          Next.js UI (:3000)
│   └── src/           app · components · lib · app/api/[...path] 프록시
├── backend/           Express 공개 API (:4000, TypeScript)
│   ├── data/          지도·daily_ml_risk JSON 사본
│   ├── migrations/    챗봇 세션·소셜 로그인 등 SQL
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
| `backend/.env` | `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | 회원·챗봇·산불이력 동기화 (ml-service 와 동일 MariaDB 권장) |
| `backend/.env` | `SESSION_SECRET`, `SESSION_IDLE_MINUTES`(선택, 기본 30) | 로그인 세션 쿠키 서명 · 유휴 만료 |
| `backend/.env` | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | 구글 OAuth (미설정 시 버튼 비활성) |
| `backend/.env` | `KAKAO_REST_API_KEY`, `KAKAO_CLIENT_SECRET`(선택) | 카카오 OAuth |
| `frontend/.env.local` | `NEXT_PUBLIC_KAKAO_MAP_KEY`, `EXPRESS_URL` | 카카오 JS 키 · Express 주소 (`http://127.0.0.1:4000` 권장) |

카카오 개발자 콘솔에서 **JavaScript 키**를 쓰고, Web 플랫폼에 `http://localhost:3000` 을 등록해야 위성 지도가 표시됩니다.

구글/카카오 로그인을 쓰려면 각 콘솔에서 OAuth Redirect URI를 등록하세요:
- 구글: `http://localhost:3000/api/auth/google/callback`
- 카카오: **앱 → 플랫폼 키 → REST API 키** 하위에 `http://localhost:3000/api/auth/kakao/callback`

`KMA_API_AUTH_KEY` / `DB_*` / `FOREST_FIRE_SERVICE_KEY` / `GEMINI_API_KEY` / `SESSION_SECRET` / `GOOGLE_CLIENT_SECRET` / `KAKAO_*` 는 프론트 `.env.local`에 두지 마세요.

### backend와 frontend가 지도 데이터를 나눠 갖는 이유

`frontend`와 `backend`는 지도 JSON(`map-data.json`, `admin-*.json`)을 각자 폴더에 **따로** 둡니다.

- `frontend/public/data` — 브라우저 첫 로딩 정적 파일
- `backend/data` — Express `/api/map/*` · 웹 이력 갱신 · 챗봇 폴백

원본 지도 JSON은 `etl`이 만듭니다. 오프라인에서 `frontend/public/data`를 갱신할 때
`etl/paths.py`의 `sync_backend_data()`가 `backend/data`로도 복사합니다.

웹 **산불이력 갱신**(`POST /api/wildfires/sync`)은 Express가 MariaDB를 읽고
`backend/data`의 건수·색만 패치합니다. `frontend/public/data`는 건드리지 않습니다.

당일 예측 스냅샷 `daily_ml_risk.json`은 Express가 `backend/data`에 저장합니다.

## 회원 · 챗봇 · 보고서 (요약)

| 기능 | 비회원 | 회원(로그인) |
|------|--------|----------------|
| 지도 · 당일/시나리오 예측 · 챗봇 Q&A | ✅ | ✅ |
| PDF 보고서 생성·다운로드 | ❌ | ✅ |
| 챗봇 대화 DB 저장 | DB 설정 시 게스트 세션 | `user_id`로 묶여 기기 무관 이어짐 |

### 회원가입 규칙

- **아이디:** 영문 소문자로 시작, 소문자+숫자만, 4~20자, 공백·특수문자 불가
- **비밀번호:** 8~20자, 영문 대문자/소문자/숫자/특수문자 중 2가지 이상 조합, 비밀번호 확인 일치 필수
- **소셜 로그인:** 구글/카카오 — **로그인 모달**에서는 기존 소셜 계정만 허용, **회원가입 모달**에서만 신규 생성 (비밀번호 없음, 닉네임 자동 배정). `intent=login|register`

### 유휴 세션

- 마지막 사용자 조작(클릭·키보드·스크롤) 기준 30분 (`SESSION_IDLE_MINUTES`)
- 자동 폴링(예측·동기화)은 연장하지 않음
- 만료 5분 전 안내 모달 (로그아웃 / 시간 연장)
- 만료되면 자동 로그아웃

- 챗봇: 예측 API(`runPredictDaily`) 우선 → 실패 시 `backend/data/daily_ml_risk.json`
- 로그인 회원은 최근 대화를 `user_id` 기준으로 불러와 Gemini·UI에 복원 (게스트는 `sessionId`)
- 「보고서 만들어줘」류 요청 / UI 보고서 버튼 → Express가 회원 확인 후 Flask `POST /report/pdf` 호출
- 보고서는 DB에 저장하지 않고, 생성 후 짧은 TTL로 다운로드만 제공합니다

자세한 API·폴더 구조는 `backend/README.md` · `frontend/README.md` · `ml-service/README.md` 참고.

## 예측 모델 (요약)

시군구×일 산불 발생 확률 — XGBoost.  
웹에서는 raw 확률(`ml_risk`) × 100을 **산불위험지수 (0~100)** 로 표시합니다.

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

웹: 우측 패널 헤더의 새로고침 버튼 클릭  
API: `POST /api/wildfires/sync` — Express가 MariaDB `forestfire_stats`를 읽어 `backend/data`의 건수·색을 패치합니다.

오프라인에서 `frontend/public/data`까지 맞추려면:

```powershell
python etl/pipeline/sync_wildfire_history.py
```

(참고) 예전 공공데이터 OpenAPI 증분 스크립트는 `etl/pipeline/sync_wildfire_openapi.py` 에 남아 있으나, **웹 버튼·기본 동기화 경로는 DB**입니다.

## Express API (공개)

**맵 · 예측 · 동기화**

- `GET /api/health`
- `GET /api/map/data`
- `GET /api/map/admin/:level` (`sido` \| `sigungu` \| `emd`)
- `POST /api/predict/daily` — body: `{ source, force, date?, weather? }`
- `POST /api/predict/scenario` — body: `{ year, month, weather: { temp_avg, humidity_avg, wind_avg, precip } }`  
  (UI는 접속 시점 월부터 12개월만 고름. 기본 선택은 다음 달)
- `POST /api/wildfires/sync` — MariaDB 산불 이력 → 맵 갱신
- `GET /api/wildfires/sync/status`

**회원** (로컬 아이디/비밀번호, 구글/카카오 OAuth, 유휴 30분 세션)

- `POST /api/auth/register` · `login` · `extend` · `logout`
- `GET /api/auth/me`
- `GET /api/auth/google` · `/kakao` · `/google/callback` · `/kakao/callback`  
  (`?intent=login|register`. 로그인은 기존 소셜 계정만, 회원가입에서만 신규 생성)

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
