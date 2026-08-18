# ForestFire Express API (`backend/`) — TypeScript

공개 웹 백엔드. Flask(`ml-service`)를 프록시하고, 회원·챗봇·보고서 게이트와 산불이력 맵 갱신을 담당합니다.  
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
| `SESSION_DAYS` | `14` | 세션 유효 기간 |

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

- `POST /api/auth/register` · `login` · `logout`
- `GET /api/auth/me`
- `GET /api/auth/google` · `/kakao` · `/google/callback` · `/kakao/callback`

**챗봇**

- `POST /api/chat` — `{ message, sessionId? }`  
  - 위험도 Q&A: 예측 API 우선 → `data/daily_ml_risk.json` 폴백 후 Gemini  
  - 로그인 회원: `user_id` 기준 최근 대화(기기 무관)를 맥락에 포함  
  - 게스트: `sessionId` 기준  
  - 「보고서」요청: **로그인 필수** → PDF 생성 후 `pdf.downloadPath` 반환
- `GET /api/chat/history` — 최근 대화 복원 (회원=`user_id`, 게스트=`?sessionId=`)

**보고서** (로그인 필수, DB에 파일 저장 안 함)

- `GET /api/report/daily` — JSON 요약
- `POST /api/report/pdf` — `{ regionQuery? }` → `{ downloadPath, filename, … }`
- `GET /api/report/download/:id` — PDF 바이너리 (임시 TTL)

PDF 본체는 `lib/reportService.ts` → Flask `POST /report/pdf` (Jinja2 + Playwright)입니다.

챗봇 세션 테이블 SQL: `migrations/001_membership_chatbot.sql`

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
    │   ├── riskSnapshot.ts · regionFocus.ts
    │   ├── adminMatch.ts · regionPath.ts · historyRefresh.ts · wildfireSync.ts
    │   ├── reportService.ts   # → Flask PDF
    │   └── reportStore.ts     # 임시 PDF 버퍼
    └── routes/
        ├── health.ts · map.ts · predict.ts · wildfires.ts
        ├── auth.ts · chat.ts · report.ts
```
