# ForestFire Express API (`backend/`) — TypeScript

공개 웹 백엔드. Flask(ml-service)를 프록시하고 지도 JSON을 서빙합니다.

```powershell
copy .env.example .env
npm install
npm run dev
```

기본 포트: 4000  
Flask URL: `ML_SERVICE_URL` (기본 `http://127.0.0.1:5000`)

## 스크립트

| 명령 | 설명 |
|------|------|
| `npm run dev` | `tsx watch` 개발 서버 |
| `npm start` | 프로덕션 실행 (`tsx`) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run build` | `dist/` 로 컴파일 |

## 폴더 구조

```
backend/src/
├── index.ts            # 진입점 (listen)
├── app.ts              # Express 앱 조립
├── config.ts           # 환경변수 · 경로
├── types.ts            # 공용 타입
├── lib/
│   ├── data.ts         # public/data JSON 읽기
│   ├── whitelist.ts    # 브라우저용 DTO 필터
│   ├── mlClient.ts     # Flask HTTP 호출
│   └── predictService.ts  # 예측 캐시 · 오케스트레이션
└── routes/
    ├── health.ts
    ├── map.ts
    ├── mountains.ts
    ├── predict.ts
    └── wildfires.ts
```
