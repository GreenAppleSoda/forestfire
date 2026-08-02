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
| `EXPRESS_URL` | Express 주소 (기본 `http://localhost:4000`, rewrite용) |

`/api/*` 는 `next.config.ts` rewrite → Express.  
서버 전용 키(`KMA_*`, `FOREST_FIRE_*`, Kakao REST 등)는 여기에 두지 마세요.

## 주요 UI

- SVG 행정구역 지도 (시도·시군구·읍면동) + 산불 이력 색
- ML 위험 점수 / 당일 예측 오버레이
- 당일 예측 (`DailyPredictForm`) · 시나리오 예측 (`ScenarioPredictForm`)
- 산 검색 · 위성 지도(카카오) · 이력 OpenAPI 동기화

초기 정적 데이터는 `public/data/` (`map-data.json`, `admin-*.json`, `sigungu_ml_scores.json`, `daily_ml_risk.json` 등)에서 로드하고, 예측·동기화는 `/api/*` 로 Express를 호출합니다.

## 폴더 구조

```
frontend/
├── public/data/           # 지도·점수 JSON (ETL·예측이 갱신)
├── src/
│   ├── app/               # Next App Router (page · layout)
│   ├── components/        # 지도 · 폼 · 검색 · 범례 등
│   └── lib/               # types · geo · choropleth · kakao 등
├── next.config.ts
└── package.json
```
