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
OAuth 콜백 리다이렉트(`redirect: "manual"`)도 올바르게 전달합니다.  
`predict` / `wildfires` / `chat` / `report` 는 타임아웃을 넉넉히 둡니다.

서버 전용 키(`KMA_*`, `DB_*`, `GEMINI_*`, `SESSION_*`, `FOREST_FIRE_*` 등)는 여기에 두지 마세요.

## 주요 UI

- 좌측 브랜드: 원형 로고(`logo-chatbot-circle.png`) + FORESTFIRE ATLAS / KOREA 텍스트 (`AppSidebar`)
- SVG 행정구역 지도 (시도·시군구·읍면동) + 산불 이력 색 / 당일·시나리오 산불위험지수 오버레이
- 위험 표시: 당일 예측 · 사용자 지정 · 과거 이력
- 당일 기상 (`DailyPredictForm`) — 지역 미선택 시 전국, 선택 시 해당 시군구(또는 시도 평균)
- 사용자 지정 시나리오 (`ScenarioPredictForm`) — 연/월 통합 선택, 접속월부터 12개월, 기본값 다음 달
- 지역·산 통합 검색 (`PlaceSearch`) — 결과는 지역/산으로 구분, 기존 선택 핸들러 유지
- 우측 패널 (`FireHistoryPanel`) — 미선택 시 전국 평균·최고 위험 시도, 선택 시 이력·산 상세
- 범례 (`MapLegend`) — 예측 모드: **산불위험지수 (0~100)** (`ml_risk × 100`)
- 위성 지도(카카오) · 일반/위성 · 보고서 · 로그인 (`MapChrome` · `AuthModal`)
- **로그인 모달** (`AuthModal`) — 아이디/비밀번호 + 구글/카카오 소셜 로그인 (로고 버튼)
- **유휴 세션 안내** (`SessionIdleHost`) — 30분 유휴 시 안내 모달 (로그아웃 / 시간 연장), 활동 감지 자동 연장
- 「산불이력 갱신」 — Express가 MariaDB → `backend/data` 패치 (`HistorySyncControl`, 과거 이력 모드)
- **안내 챗봇** (`ChatWidget`) — 비로그인 Q&A 가능; 「보고서 만들어줘」는 회원 + PDF 다운로드 버튼
- **보고서** (`ReportModal`) — 회원 전용 JSON 요약 · 슬라이드형 PDF 다운로드

초기 정적 데이터는 `public/data/` (`map-data.json`, `admin-*.json`, `sigungu_ml_scores.json` 등)에서 로드하고, 예측·이력 동기화·인증·챗봇·보고서는 `/api/*` 로 Express를 호출합니다. 이력 갱신 후에는 `/api/map/*`로 지도를 다시 읽습니다.

`daily_ml_risk.json`은 브라우저가 필수로 읽지 않습니다(당일 예측은 API). 예측 파이프라인이 남겨 두는 스냅샷이며, 서버(`backend/data`) 쪽이 챗봇 폴백·리포트에 쓰입니다.

## 폴더 구조

```
frontend/
├── public/
│   ├── data/                      # 지도·점수 JSON (ETL·이력 갱신이 갱신)
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
    │       # types · apiJson · authContext · authValidation · choropleth · nationalRisk …
├── next.config.ts
└── package.json
```
