# FORESTFIRE ATLAS KOREA — Frontend (Next.js)

UI만 담당합니다. API·예측·회원(로컬+구글/카카오 OAuth)·챗봇·PDF는 Express(`backend/`) / Flask(`ml-service`)가 처리합니다.

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
PDF 다운로드의 `Content-Disposition`도 그대로 넘깁니다.  
OAuth 콜백 리다이렉트(`redirect: "manual"`)도 올바르게 전달합니다.  
`predict` / `wildfires` / `chat` / `report` 는 타임아웃을 넉넉히 둡니다.

서버 전용 키(`KMA_*`, `DB_*`, `GEMINI_*`, `SESSION_*`, `FOREST_FIRE_*` 등)는 여기에 두지 마세요.

## 주요 UI

- 좌측 브랜드: 원형 로고(`logo-chatbot-circle.png`) + FORESTFIRE ATLAS / KOREA 텍스트 (`AppSidebar`)
- 좌측 하단: **최근 산불 발생** 피드 — DB 이력에서 최근 5건을 날짜·지역명으로 표시
- SVG 행정구역 지도 (시도·시군구·읍면동) + 산불 이력 색 / 당일·시나리오 산불위험지수 오버레이
- 위험 표시: 당일 예측 · 사용자 지정 · 과거 이력
- 당일 기상 (`DailyPredictForm`) — 지역 미선택 시 전국, 선택 시 해당 시군구(또는 시도 평균)
- 사용자 지정 시나리오 (`ScenarioPredictForm`) — 연/월 통합 선택, 접속월부터 12개월, 기본값 다음 달
- 지역·산 통합 검색 (`PlaceSearch`) — 결과는 지역/산으로 구분, 기존 선택 핸들러 유지
- 우측 패널 (`FireHistoryPanel`) — 헤더에 전체 건수·갱신 날짜·갱신 버튼, 미선택 시 전국 평균·최고 위험 시도, 선택 시 이력·산 상세
- 범례 (`MapLegend`) — 지도 우측 하단, 예측 모드: **산불위험지수 (0~100)** (`ml_risk × 100`). 상단 오버레이(`z-40`)가 범례(`z-20`)보다 위라 보고서 모달이 가리지 않음
- 위성 지도(카카오) · 일반/위성 · 보고서 · 로그인 (`MapChrome` · `AuthModal`)
- **로그인 모달** (`AuthModal`) — 아이디/비밀번호 + 구글/카카오 소셜 버튼. 로그인 모드는 `intent=login`(기존 계정만), 회원가입 모드는 `intent=register`(없으면 생성)
- **유휴 세션 안내** (`SessionIdleHost`) — 30분 유휴 시 안내 모달 (로그아웃 / 시간 연장), 활동 감지 자동 연장
- 「산불이력 갱신」 — 우측 패널 헤더의 새로고침 버튼 → Express가 MariaDB → `backend/data` 패치 (`useHistorySync` 훅)
- **안내 챗봇** (`ChatWidget`) — 비로그인 Q&A 가능; 「보고서 만들어줘」는 회원 + PDF 다운로드 버튼
- **보고서** (`ReportModal`) — 회원 전용 JSON 요약 · 슬라이드형 PDF는 blob 다운로드(화면 유지)

지도 JSON(`map-data.json`, `admin-*.json`)은 첫 로딩부터 `/api/map/*`(`backend/data`)를 읽고, Express가 없으면 `public/data/`로 폴백합니다 (`src/lib/mapBundle.ts`). `sigungu_ml_scores.json`은 계속 `public/data/`입니다. 예측·이력 동기화·인증·챗봇·보고서는 `/api/*`입니다.

`daily_ml_risk.json`은 브라우저가 필수로 읽지 않습니다(당일 예측은 API). 예측 파이프라인이 남겨 두는 스냅샷이며, 서버(`backend/data`) 쪽이 챗봇 폴백·리포트에 쓰입니다.

## 폴더 구조

```
frontend/
├── public/
│   ├── data/                      # 폴백·ETL 산출물 (첫 로딩은 /api/map/* 우선)
│   ├── logo-chatbot-circle.png    # 사이드바·챗봇 원형 로고
│   ├── logo-forestfire-atlas.png  # 원본 로고 잠금(참고)
│   └── chat-bubble.svg
├── src/
│   ├── app/
│   │   ├── page.tsx · layout.tsx   # AuthProvider · SessionIdleHost · ChatWidget
│   │   └── api/[...path]/route.ts  # Express 프록시 (+ 쿠키 + OAuth 리다이렉트)
│   ├── components/
│   │   # KoreaSvgMap · AppSidebar · PlaceSearch · FireHistoryPanel
│   │   # DailyPredictForm · ScenarioPredictForm · MapLegend
│   │   # AuthModal · SessionIdleHost · MapChrome · ChatWidget · ReportModal …
│   └── lib/
│       # types · apiJson · mapBundle · authContext · authValidation · choropleth · nationalRisk …
├── next.config.ts
└── package.json
```
