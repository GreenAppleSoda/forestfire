# ForestFire Express API (`backend/`) — TypeScript

공개 웹 백엔드. Flask(`ml-service`)를 프록시하고, 회원(로컬+구글/카카오 OAuth)·챗봇·보고서 게이트와 산불이력 맵 갱신을 담당합니다.  
지도 JSON은 자체 `backend/data`에서 서빙·패치합니다.  
브라우저로 나가는 예측·맵 응답은 `lib/whitelist.ts` 로 필터합니다.

```powershell
cd backend
# .env 작성 (아래 환경변수 · 또는 .env.example 참고)
npm install
npm run dev
```

기본 포트: `4000`  
Flask URL: `ML_SERVICE_URL` (기본 `http://127.0.0.1:5000`)

## 환경변수 (`backend/.env`)

| 키 | 기본 | 용도 |
|----|------|------|
| `PORT` | `4000` | 리스닝 포트 |
| `FRONTEND_ORIGIN` | `http://localhost:3000` | CORS (`credentials: true`) |
| `ML_SERVICE_URL` | `http://127.0.0.1:5000` | Flask |
| `PREDICT_CACHE_MS` | `1800000` (30분) | 당일 예측 캐시 TTL |
| `DATA_DIR` | `backend/data` | 지도·`daily_ml_risk.json` 폴더 (ROOT 기준 상대경로) |
| `GEMINI_API_KEY` | — | 안내 챗봇 (없으면 `/api/chat` → 503) |
| `GEMINI_MODEL` | `gemini-2.5-flash` | Gemini 모델명 |
| `DB_HOST` 등 | — | MariaDB `users` · `chat_*` · `forestfire_stats` (미설정 시 챗봇은 동작, 대화 비영속 / 이력 동기화 불가) |
| `SESSION_SECRET` | (개발용 기본값) | 로그인 쿠키 HMAC — **배포 시 반드시 변경** |
| `SESSION_IDLE_MINUTES` | `30` | 유휴 세션(조작 없을 때 로그아웃) |
| `GOOGLE_CLIENT_ID` | — | 구글 OAuth 클라이언트 ID |
| `GOOGLE_CLIENT_SECRET` | — | 구글 OAuth 클라이언트 시크릿 |
| `KAKAO_REST_API_KEY` | — | 카카오 REST API 키 |
| `KAKAO_CLIENT_SECRET` | — | (선택) 카카오 Client Secret |
| `OAUTH_REDIRECT_BASE` | `FRONTEND_ORIGIN` | OAuth 콜백 베이스 URL |

## 스크립트

| 명령 | 설명 |
|------|------|
| `npm run dev` | `tsx watch` 개발 서버 |
| `npm start` | 프로덕션 실행 (`tsx`) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run build` | `dist/` 로 컴파일 |

## 공개 API (`/api`)

**맵 · 예측 · 동기화**

- `GET /api/health`
- `GET /api/map/data` · `/api/map/admin/:level`
- `POST /api/predict/daily` · `POST /api/predict/scenario`  
  (`scenario` body: `{ year, month, weather }`. 프론트 UI는 접속월부터 12개월만 노출)
- `POST /api/wildfires/sync` · `GET /api/wildfires/sync/status` — MariaDB → `backend/data` 이력 패치

**회원** (로컬 아이디/비밀번호, 구글/카카오 OAuth)

- `POST /api/auth/register` · `login` · `extend` · `logout`
- `GET /api/auth/me`
- `GET /api/auth/google` · `/kakao` · `/google/callback` · `/kakao/callback`  
  (`?intent=login|register`. 로그인 모드는 기존 계정만, 회원가입 모드에서만 신규 생성)

**챗봇**

- `POST /api/chat` — `{ message, sessionId? }`  
  - 위험도 Q&A: 예측 API 우선 → `data/daily_ml_risk.json` 폴백 후 Gemini  
  - 로그인 회원: `user_id` 기준 최근 대화(기기 무관)를 맥락에 포함  
  - 게스트: `sessionId` 기준  
  - 「보고서/PDF」요청: **로그인 필수** → `lib/regionFocus.ts`로 지역 해석  
    (현재 메시지 → 최근 유저 발화 → 어시스턴트; 「예시)」는 제외) → 없으면 되묻기 → PDF 생성 후 `pdf.downloadPath` 반환
- `GET /api/chat/history` — 최근 대화 조회 (회원=`user_id`, 게스트=`?sessionId=`; UI는 「이전 대화내역 불러오기」로 호출)

**보고서** (로그인 필수, DB에 파일 저장 안 함)

- `GET /api/report/daily` — JSON 요약
- `POST /api/report/pdf` — `{ regionQuery? }` → `{ downloadPath, filename, … }`
- `GET /api/report/download/:id` — PDF 바이너리 (임시 TTL, `Content-Disposition: attachment`)

PDF 본체는 `lib/reportService.ts` → Flask `POST /report/pdf` (Jinja2 + Playwright)입니다.

### 회원가입 규칙

- **아이디:** 영문 소문자로 시작, 소문자+숫자만, 4~20자 (`lib/authValidation.ts`)
- **비밀번호:** 8~20자, 대문자/소문자/숫자/특수문자 중 2종 이상, 비밀번호 확인 일치
- **소셜:** 구글/카카오 OAuth. `intent=login`이면 미가입 계정은 거절(`social_not_registered`), `intent=register`일 때만 신규 생성 (비밀번호 없음)

### 유휴 세션 (30분)

- 마지막 사용자 조작 기준 `SESSION_IDLE_MINUTES`(기본 30분) 후 자동 만료
- `GET /api/auth/me` 응답에 `expiresAt` 포함 → 프론트가 타이머·안내 모달 표시
- `POST /api/auth/extend` — 세션 연장 (새 쿠키 발급)

### DB 마이그레이션

| 파일 | 내용 |
|------|------|
| `001_membership_chatbot.sql` | 챗봇 세션·메시지 테이블 |
| `002_daily_ml_risk.sql` | 당일 예측 캐시 |
| `003_users_drop_unused_columns.sql` | 미사용 컬럼 정리 |
| `005_users_social_oauth.sql` | `login_id` NULL 허용, `email`·`social_id` 추가, 소셜 유니크 인덱스 |

## 폴더 구조

```
backend/
├── data/                  # map-data · admin-* · daily_ml_risk.json · wildfire_sync_state.json
├── migrations/
├── .env.example
└── src/
    ├── index.ts · app.ts · config.ts · types.ts
    ├── middleware/optionalAuth.ts
    ├── lib/
    │   ├── data.ts · whitelist.ts · mlClient.ts · predictService.ts
    │   ├── db.ts · gemini.ts · session.ts · users.ts
    │   ├── authValidation.ts  # 아이디·비밀번호 검증
    │   ├── oauth.ts           # 구글·카카오 OAuth 유틸
    │   ├── riskSnapshot.ts · regionFocus.ts
    │   ├── adminMatch.ts · regionPath.ts · historyRefresh.ts · wildfireSync.ts
    │   ├── reportService.ts   # → Flask PDF
    │   └── reportStore.ts     # 임시 PDF 버퍼
    └── routes/
        ├── health.ts · map.ts · predict.ts · wildfires.ts
        ├── auth.ts · oauth.ts · chat.ts · report.ts
```
