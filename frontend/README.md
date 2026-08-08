# 산불맵 Frontend (Next.js)

UI만 담당합니다. API·예측은 Express(`backend/`) / Flask(`ml-service`)가 처리합니다.

```powershell
cd frontend
# .env.local 작성 (아래 환경변수)
npm install
npm run dev
```

브라우저: http://localhost:3000

루트 `README.md`의 3-프로세스 실행 방법을 함께 보세요. Flask → Express → Next 순으로 띄우는 것을 권장합니다.

## 환경변수 (`frontend/.env.local`)

| 키 | 용도 |
|----|------|
| `NEXT_PUBLIC_KAKAO_MAP_KEY` | 카카오 지도 JavaScript 키 (위성 맵) |
| `EXPRESS_URL` | Express 주소 (기본·권장 `http://127.0.0.1:4000`) |

`/api/*` 는 `app/api/[...path]/route.ts` 가 Express로 프록시합니다.  
(연결 실패 시에도 JSON 에러를 돌려, plain `Internal Server Error` 파싱 문제를 피합니다.)

서버 전용 키(`KMA_*`, `DB_*`, `FOREST_FIRE_*` 등)는 여기에 두지 마세요.

## 주요 UI

- SVG 행정구역 지도 (시도·시군구·읍면동) + 산불 이력 색
- ML 위험 점수 / 당일 예측 오버레이
- 당일 예측 (`DailyPredictForm`) · 시나리오 예측 (`ScenarioPredictForm`)
- 산 검색 · 위성 지도(카카오)
- 「산불이력 갱신」 — MariaDB → 맵 JSON (`HistorySyncControl`)

초기 정적 데이터는 `public/data/` (`map-data.json`, `admin-*.json`, `sigungu_ml_scores.json` 등)에서 로드하고, 예측·동기화는 `/api/*` 로 Express를 호출합니다.

## 폴더 구조

```
frontend/
├── public/data/           # 지도·점수 JSON (ETL·이력 갱신이 갱신)
├── src/
│   ├── app/
│   │   ├── page.tsx · layout.tsx
│   │   └── api/[...path]/route.ts   # Express 프록시
│   ├── components/        # 지도 · 폼 · 검색 · 범례 등
│   └── lib/               # types · apiJson · geo · choropleth · kakao 등
├── next.config.ts
└── package.json
```
