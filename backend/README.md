# ForestFire Express API (`backend/`) — TypeScript

공개 웹 백엔드. Flask(`ml-service`)를 프록시하고 자체 `backend/data` 지도 JSON을 서빙합니다
(`etl`이 `frontend/public/data`와 자동 동기화 — 루트 `README.md`의 "backend와 frontend가 지도 데이터를 나눠 갖는 이유" 참고).  
브라우저로 나가는 예측·맵 응답은 `lib/whitelist.ts` 로 필터합니다.

```powershell
cd backend
# .env 작성 (아래 환경변수)
npm install
npm run dev
```

기본 포트: `4000`  
Flask URL: `ML_SERVICE_URL` (기본 `http://127.0.0.1:5000`)

## 환경변수 (`backend/.env`)

| 키 | 기본 | 용도 |
|----|------|------|
| `PORT` | `4000` | 리스닝 포트 |
| `FRONTEND_ORIGIN` | `http://localhost:3000` | CORS |
| `ML_SERVICE_URL` | `http://127.0.0.1:5000` | Flask |
| `PREDICT_CACHE_MS` | `1800000` (30분) | 당일 예측 캐시 TTL |
| `DATA_DIR` | `backend/data` | 지도 JSON 폴더 (ROOT 기준 상대경로). `etl`이 `frontend/public/data`와 자동 동기화해 줌 (하드코딩 아님) |

## 스크립트

| 명령 | 설명 |
|------|------|
| `npm run dev` | `tsx watch` 개발 서버 |
| `npm start` | 프로덕션 실행 (`tsx`) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run build` | `dist/` 로 컴파일 |

## 공개 API (`/api`)

- `GET /api/health`
- `GET /api/map/data` · `/api/map/admin/:level`
- `POST /api/predict/daily`
- `POST /api/predict/scenario`
- `POST /api/wildfires/sync` · `GET /api/wildfires/sync/status` — MariaDB 산불 이력 → 맵 갱신

상세 요청/응답은 루트 `README.md` 참고.

## 폴더 구조

```
backend/src/
├── index.ts               # 진입점 (listen)
├── app.ts                 # Express 앱 조립
├── config.ts              # 환경변수 · 경로
├── types.ts               # 공용 타입
├── lib/
│   ├── data.ts            # backend/data JSON 읽기
│   ├── whitelist.ts       # 브라우저용 DTO 필터
│   ├── mlClient.ts        # Flask HTTP 호출
│   └── predictService.ts  # 예측 캐시 · 오케스트레이션
└── routes/
    ├── health.ts
    ├── map.ts
    ├── predict.ts
    └── wildfires.ts
```
