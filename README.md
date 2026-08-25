# FORESTFIRE ATLAS KOREA

South Korea Wildfire Atlas — 시군구 산불 위험 지도·예측 웹서비스.

지도·당일/시나리오 예측에 더해 **회원 로그인**(로컬 아이디 + 구글/카카오 OAuth), **Gemini 안내 챗봇**, **지역별 PDF 보고서**(회원 전용)를 제공합니다.  
화면에 보이는 당일·시나리오 값은 XGBoost `predict_proba` raw 확률(`ml_risk`)을 ×100 한 **산불위험지수 (0~100)** 입니다.

## 주요 화면

- 좌측: FORESTFIRE ATLAS KOREA 브랜드, 지역·산 통합 검색, 위험 표시(당일 예측 / 사용자 지정 / 과거 이력), **최근 산불 발생** 피드(날짜만, 클릭 시 지도에 빨간 핀)
- 지도: SVG 행정구역 + 카카오 위성. 산 검색은 **파란 핀**, 산불 이력 클릭은 **빨간 핀**. 범례는 우측 하단(예측 모드: 산불위험지수 0~100 · 예측일 · AUC)
- 우측: 접을 수 있는 패널. 전체 산불 건수·갱신 날짜·갱신 버튼, 지역 미선택 시 전국 평균·최고 위험 시도 요약 → 선택 시 이력(날짜만)·산 상세(산림청 이미지). 로그인 시 지도 상단에 보고서 버튼
- 사용자 지정: 접속월부터 12개월만 선택(기본값 다음 달). 월별 평년 기상에 프리셋(평년 / 건조·강풍 / 고온·건조 / 습함·비 많음)을 더해 슬라이더로 조정. API는 `year`/`month`/`weather` 그대로 전달
- 기상 카드: 선택 지역이 있으면 해당 시군구(또는 시도 평균) 기상

## 런타임 구조 (역할 분리)

| 프로세스 | 폴더 | 포트 | 역할 |
|----------|------|------|------|
| Next.js | `frontend/` | 3000 | UI · `/api` → Express 프록시 · 챗봇·로그인·보고서 모달 · 산 이미지 정적 파일 |
| Express | `backend/` | 4000 | 공개 API · 회원/세션 · 챗봇 · 산불이력 맵 갱신 · 보고서 게이트 · Flask 프록시 · DTO 화이트리스트 |
| Flask | `ml-service/` | 5000 | 예측 · PDF 렌더(Playwright) · localhost 전용 · 당일 예측 DB 스냅샷 |
| 배치 ETL | `etl/` | — | 전처리·학습·산 이미지·법정동 lookup (웹 요청에서 실행하지 않음) |

```
브라우저 → Next(:3000) ─Route Handler─→ Express(:4000) → Flask(:5000)
                                    ↘ map JSON · Gemini · 회원 DB
```

`/api/*` 는 `frontend/src/app/api/[...path]/route.ts` 가 Express로 넘깁니다.  
쿠키·`Set-Cookie`와 PDF의 `Content-Disposition`도 전달합니다.  
브라우저에는 Express가 필터한 DTO만 전달됩니다. 파이썬 stdout·모델 경로·API 키는 응답에 포함되지 않습니다.

**PDF 보고서:** 회원 세션 확인(Express) → `ml-service` Jinja2+Playwright로 **A4 가로** PDF 생성 → 메모리에 임시 보관(TTL 30분) 후 다운로드 URL 발급.  
표지(발행일·작성·닉네임 + 요약·게이지) 뒤 본문. 전국 리포트는 시군구 순위를 **상위 10·하위 5**만 넣고, 특정 지역 리포트는 해당 범위를 유지합니다.

## 데이터 소스 (현재)

| 용도 | 우선 소스 | 비고 |
|------|-----------|------|
| 산불 이력 (맵 갱신·학습·분석) | MariaDB `forestfire_stats` | 실패 시 `refined_wildfire_data.csv` 폴백 |
| 예측용 당일 기상 | 기상청 ASOS API | `KMA_API_AUTH_KEY` |
| 예측용 lag 기상 (어제·그저께) | MariaDB `weather_daily_sigungu` | 실패 시 CSV 폴백 |
| 학습용 기상 | MariaDB 우선 | 동일 테이블 / CSV 폴백 |
| 지도 JSON | `frontend/public/data` + `backend/data` | 첫 로딩은 `/api/map/*`(`backend/data`). Express 불가 시에만 `frontend/public/data` 폴백. 웹 이력 갱신은 `backend/data`만 패치 |
| 챗봇·리포트용 당일 예측 스냅샷 | `backend/data/daily_ml_risk.json` | Express가 예측 API 성공 시 저장. Flask는 같은 결과를 MariaDB `daily_ml_risk_runs` / `daily_ml_risk_regions`에도 적재. 챗봇은 예측 API 우선, 실패 시 파일 폴백 |
| 산 썸네일 | `frontend/public/data/mountain-images/` | 오프라인 `etl/pipeline/fetch_mountain_images.py` (산림청 산정보 OpenAPI). 런타임에 API를 치지 않음 |
| 지역명 정규화 | `legal-dong-lookup.json` | UI는 `frontend/public/data`. Express는 `backend/data` → frontend 경로 폴백 |

`refined_wildfire_data.csv` 는 더 이상 주 데이터가 아닙니다. DB가 정상이면 없어도 일상 운영(예측·이력 갱신·학습)이 가능합니다.

회원/비회원은 **로그인 세션 유무**로만 구분합니다. 구독·결제 테이블은 사용하지 않습니다.  
로그인은 로컬(아이디/비밀번호) + 구글/카카오 OAuth를 지원하며, 유휴 30분 후 자동 로그아웃됩니다(연장 가능).

## 폴더 구조

```
ForestFire/
├── frontend/          Next.js UI (:3000, Docker standalone)
│   ├── public/data/   폴백 지도 JSON · legal-dong-lookup · mountain-images
│   └── src/           app · components · lib · app/api/[...path] 프록시
├── backend/           Express 공개 API (:4000, TypeScript)
│   ├── data/          지도·daily_ml_risk JSON 사본
│   ├── migrations/    챗봇 세션·소셜 로그인·당일 예측 테이블 SQL
│   └── src/
├── ml-service/        Flask (:5000, localhost)
│   ├── models/        XGBoost 모델 JSON
│   ├── reference/     시군구 hist · 관측소 매핑 CSV
│   ├── predict/       예측 엔진 + weather_db · fire_db · risk_snapshot_db
│   ├── report/        지역별 PDF (Jinja2 + Playwright)
│   └── routes/        health · predict · report
├── etl/               오프라인 ETL · 분석 · 학습 · 산 이미지
├── db/                로컬 대용량 CSV (Git 제외)
└── db-archive/        ETL·분석 원본·중간 산출물 (Git 제외)
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

기동 시 당일 예측을 몇 번 재시도해 캐시에 올려 둡니다(Flask가 늦게 떠도 대비).

### 3) Next.js (`frontend`)

```powershell
cd frontend
# .env.local 에 NEXT_PUBLIC_KAKAO_MAP_KEY · EXPRESS_URL 입력
npm install
npm run dev
```

브라우저: http://localhost:3000  
헬스: http://localhost:4000/api/health

### Frontend Docker (선택)

`next.config.ts` 는 `output: "standalone"` 입니다. Lightsail 등에서 UI만 컨테이너로 올릴 때:

```powershell
cd frontend
docker compose --env-file .env.local up -d --build
```

빌드 인자로 `NEXT_PUBLIC_KAKAO_MAP_KEY` · `EXPRESS_URL` 이 들어갑니다. 호스트 80 → 컨테이너 3000. Express·Flask는 별도 프로세스입니다.

## 환경변수

| 위치 | 키 | 용도 |
|------|-----|------|
| `ml-service/.env` | `KMA_API_AUTH_KEY` | 기상청 ASOS (당일 예측) |
| `ml-service/.env` | `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | MariaDB (산불·lag 기상·당일 예측 스냅샷) |
| `ml-service/.env` | `ML_HOST`, `ML_PORT` | 바인딩 (기본 `127.0.0.1:5000`) |
| `ml-service/.env` | `FOREST_FIRE_SERVICE_KEY` | (선택) 레거시 OpenAPI 스크립트용 |
| `etl/.env` 또는 루트 `.env` | `FOREST_MOUNTAIN_SERVICE_KEY` | 산림청 산정보·산 이미지 수집 (오프라인 ETL만) |
| `backend/.env` | `PORT`, `FRONTEND_ORIGIN`, `ML_SERVICE_URL`, `PREDICT_CACHE_MS`, `DATA_DIR` | CORS · Flask URL · 예측 캐시 · 지도 데이터 폴더 |
| `backend/.env` | `GEMINI_API_KEY`, `GEMINI_MODEL`(선택) | 안내 챗봇 (`/api/chat`) |
| `backend/.env` | `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | 회원·챗봇·산불이력 동기화 (ml-service 와 동일 MariaDB 권장) |
| `backend/.env` | `SESSION_SECRET`, `SESSION_IDLE_MINUTES`(선택, 기본 30) | 로그인 세션 쿠키 서명 · 유휴 만료 |
| `backend/.env` | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | 구글 OAuth (미설정 시 버튼 비활성) |
| `backend/.env` | `KAKAO_REST_API_KEY`, `KAKAO_CLIENT_SECRET`(선택) | 카카오 OAuth |
| `backend/.env` | `OAUTH_REDIRECT_BASE`(선택) | OAuth 콜백 베이스. 기본값은 `FRONTEND_ORIGIN` |
| `frontend/.env.local` | `NEXT_PUBLIC_KAKAO_MAP_KEY`, `EXPRESS_URL` | 카카오 JS 키 · Express 주소 (`http://127.0.0.1:4000` 권장) |

카카오 개발자 콘솔에서 **JavaScript 키**를 쓰고, Web 플랫폼에 `http://localhost:3000` 을 등록해야 위성 지도가 표시됩니다.

구글/카카오 로그인을 쓰려면 각 콘솔에서 OAuth Redirect URI를 등록하세요:
- 구글: `http://localhost:3000/api/auth/google/callback`
- 카카오: **앱 → 플랫폼 키 → REST API 키** 하위에 `http://localhost:3000/api/auth/kakao/callback`

`KMA_API_AUTH_KEY` / `DB_*` / `FOREST_FIRE_SERVICE_KEY` / `FOREST_MOUNTAIN_SERVICE_KEY` / `GEMINI_API_KEY` / `SESSION_SECRET` / `GOOGLE_CLIENT_SECRET` / `KAKAO_*` 는 프론트 `.env.local`에 두지 마세요.

### backend와 frontend가 지도 데이터를 나눠 갖는 이유

`frontend`와 `backend`는 지도 JSON(`map-data.json`, `admin-*.json`)을 각자 폴더에 **따로** 둡니다.

- `backend/data` — 브라우저 첫 로딩(`/api/map/*`) · 웹 이력 갱신 · 챗봇 폴백
- `frontend/public/data` — Express가 꺼져 있을 때의 폴백 · ETL 원본 배포본 · 산 이미지 · 법정동 lookup

원본 지도 JSON은 `etl`이 만듭니다. 오프라인에서 `frontend/public/data`를 갱신할 때
`etl/paths.py`의 `sync_backend_data()`가 `backend/data`로도 복사합니다.

웹 **산불이력 갱신**(`POST /api/wildfires/sync`)은 Express가 MariaDB를 읽고
`backend/data`의 건수·색만 패치합니다. `frontend/public/data`는 건드리지 않습니다.
페이지를 새로고침해도 브라우저는 `/api/map/*`를 다시 읽으므로, 직전에 동기화한
건수·최근 이력이 유지됩니다.

당일 예측 스냅샷 `daily_ml_risk.json`은 Express가 `backend/data`에 저장합니다.

산 이미지 파일은 Next 정적 경로(`/data/mountain-images/{산코드}.jpg`)입니다. Git에는 `.gitkeep`만 두고 이미지는 제외합니다.

## 회원 · 챗봇 · 보고서 (요약)

| 기능 | 비회원 | 회원(로그인) |
|------|--------|----------------|
| 지도 · 당일/시나리오 예측 · 챗봇 Q&A | ✅ | ✅ |
| 챗봇 「이전 대화내역 불러오기」 | ❌ | ✅ |
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

### 챗봇 · PDF

- 챗봇: 예측 API(`runPredictDaily`) 우선 → 실패 시 `backend/data/daily_ml_risk.json`
- 로그인 회원은 최근 대화를 `user_id` 기준으로 Gemini 맥락에 포함 (게스트는 `sessionId`). 로그인 직후 게스트로 쓰던 `sessionId`는 계정 히스토리에 합쳐집니다
- 게스트 세션 ID는 브라우저 `localStorage`. HTTPS·localhost가 아니면 `crypto.randomUUID`가 없을 수 있어, 프론트에서 UUID v4 폴백으로 발급 (`frontend/src/components/ChatWidget.tsx`)
- UI는 열 때 인삿말만 보임. **「이전 대화내역 불러오기」는 로그인 회원만** 표시. 헤더에 닉네임·회원/게스트 뱃지
- 「보고서/PDF 만들어줘」: **로그인 필수**. `regionFocus`가 확신 있는 지명만 추출(잡음·예시·따옴표 문장 제외). 순서는 현재 문장 → 최근 유저 발화 → 어시스턴트. 「전국」도 가능. 없으면 지역을 되물은 뒤 Flask `POST /report/pdf`
- 보고서는 DB에 저장하지 않고, 생성 후 30분 TTL로 다운로드만 제공합니다
- 지도 **보고서** 모달의 PDF는 blob 다운로드(화면 유지). 모달은 상단 오버레이가 범례보다 위. 챗봇 PDF는 다운로드 링크
- 챗봇 창은 헤더 드래그로 위치 이동 가능 (플로팅 버튼은 우측 하단 고정)

자세한 API·폴더 구조는 `backend/README.md` · `frontend/README.md` · `ml-service/README.md` 참고.

## 예측 모델 (요약)

시군구×일 산불 발생 확률 — XGBoost.  
웹에서는 raw 확률(`ml_risk`) × 100을 **산불위험지수 (0~100)** 로 표시합니다.

**피처 (10):** `temp_avg`, `precip`, `wind_avg`, `humidity_avg`, `hist_fire_rate`, `hist_fire_count_365`, `dwi`, `precip_sum_7d`, `precip_sum_14d`, `dry_days`

| 단계 | 위치 |
|------|------|
| 학습 | `etl/ml/train_wildfire_xgb.py` (기상·산불: MariaDB 우선) |
| 추론 | `ml-service/predict/daily.py` |
| 산출물 | `ml-service/models/wildfire_xgb_*.json`, `ml-service/reference/sigungu_hist_state.csv` 등 |
| DB 스냅샷 | `daily_ml_risk_runs` + `daily_ml_risk_regions` (`backend/migrations/002_daily_ml_risk.sql`) |

CLI 예측:

```powershell
cd ml-service
python -m predict.daily --kma
```

당일 KMA 예측이 끝나면 Flask가 MariaDB에도 UPSERT 합니다(시나리오 예측은 넣지 않음). 테이블이 없거나 `DB_*`가 비어 있으면 로그만 남기고 예측 HTTP는 그대로 응답합니다.

## 산불 이력 갱신 (MariaDB)

웹: 우측 패널 헤더의 새로고침 버튼 클릭  
API: `POST /api/wildfires/sync` — Express가 MariaDB `forestfire_stats`를 읽어 `backend/data`의 건수·색을 패치합니다.
웹 첫 화면·F5도 같은 `/api/map/*`를 읽습니다. `frontend/public/data`는 Express 불가 시 폴백입니다.

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
  (UI는 접속월부터 12개월, 기본 다음 달. 월별 평년 + 프리셋으로 기상 슬라이더를 채움)
- `POST /api/wildfires/sync` — MariaDB 산불 이력 → 맵 갱신
- `GET /api/wildfires/sync/status`

**회원** (로컬 아이디/비밀번호, 구글/카카오 OAuth, 유휴 30분 세션)

- `POST /api/auth/register` · `login` · `extend` · `logout`
- `GET /api/auth/me`
- `GET /api/auth/google` · `/kakao` · `/google/callback` · `/kakao/callback`  
  (`?intent=login|register`. 로그인은 기존 소셜 계정만, 회원가입에서만 신규 생성)

**챗봇 · 보고서**

- `POST /api/chat` — body: `{ message, sessionId? }` (비로그인 가능; 보고서 요청은 회원; 회원은 user 기준 히스토리; PDF 지역은 대화 맥락·`regionFocus`)
- `GET /api/chat/history` — 최근 대화 (회원=`user_id`, 게스트=`sessionId`). **UI 불러오기 버튼은 회원만**
- `GET /api/report/daily` — JSON 요약 (**회원**)
- `POST /api/report/pdf` — body: `{ regionQuery? }` → 다운로드 메타 (**회원**, 비우면 전국)
- `GET /api/report/download/:id` — PDF 바이너리 (**회원**, 메모리 TTL 30분, `Content-Disposition: attachment`)

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
python etl/pipeline/build_legal_dong_lookup.py
python etl/analyze/analyze_wildfire_mountain_events.py
python etl/map/build_admin_layers.py
python etl/map/export_map_data.py
python etl/pipeline/fetch_mountain_images.py
python etl/map/compress_web_data.py
python etl/ml/train_wildfire_xgb.py
cd ml-service; python -m predict.daily --kma
```

경로 상수는 `etl/paths.py` 한곳에서 관리합니다.  
산불 원본 로드는 `etl/pipeline/load_wildfire_history.py` (DB 우선)를 공통으로 씁니다.
