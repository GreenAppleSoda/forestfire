# 산불맵 Frontend (Next.js)

UI만 담당합니다. API·예측·회원·챗봇·PDF는 Express(`backend/`) / Flask(`ml-service`)가 처리합니다.

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
쿠키(로그인 세션)와 `Set-Cookie`를 양방향으로 전달합니다.  
`predict` / `wildfires` / `chat` / `report` 는 타임아웃을 넉넉히 둡니다.

서버 전용 키(`KMA_*`, `DB_*`, `GEMINI_*`, `SESSION_*`, `FOREST_FIRE_*` 등)는 여기에 두지 마세요.

## 주요 UI

- SVG 행정구역 지도 (시도·시군구·읍면동) + 산불 이력 색
- ML 위험 점수 / 당일 예측 오버레이
- 당일 예측 (`DailyPredictForm`) · 시나리오 예측 (`ScenarioPredictForm`)
- 산 검색 · 위성 지도(카카오)
- 「산불이력 갱신」 — MariaDB → 맵 JSON (`HistorySyncControl`)
- **로그인 / 회원가입** (`AuthModal` · `MapChrome`)
- **안내 챗봇** (`ChatWidget`) — 비로그인 Q&A 가능; 「보고서 만들어줘」는 회원 + PDF 다운로드 버튼
- **보고서** (`ReportModal`) — 회원 전용 JSON 요약 · 슬라이드형 PDF 다운로드

초기 정적 데이터는 `public/data/` (`map-data.json`, `admin-*.json`, `sigungu_ml_scores.json` 등)에서 로드하고, 예측·동기화·인증·챗봇·보고서는 `/api/*` 로 Express를 호출합니다.

`daily_ml_risk.json`은 브라우저가 필수로 읽지 않습니다(당일 예측은 API). 예측 파이프라인이 남겨 두는 스냅샷이며, 서버(`backend/data`) 쪽이 챗봇 폴백·리포트에 쓰입니다.

## 폴더 구조

```
frontend/
├── public/
│   ├── data/              # 지도·점수 JSON (ETL·이력 갱신이 갱신)
│   └── chat-bubble.svg
├── src/
│   ├── app/
│   │   ├── page.tsx · layout.tsx   # AuthProvider · ChatWidget
│   │   └── api/[...path]/route.ts  # Express 프록시 (+ 쿠키)
│   ├── components/
│   │   # 지도 · 폼 · AuthModal · MapChrome · ChatWidget · ReportModal …
│   └── lib/
│       # types · apiJson · authContext · choropleth · kakao …
├── next.config.ts
└── package.json
```
