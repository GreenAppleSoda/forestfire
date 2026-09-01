# ForestFire ML Service (Flask)

당일·시나리오 산불 위험 예측과 PDF 리포트 — **localhost 전용**.  
Express(`backend/`)만 호출하세요. 웹 산불이력 갱신은 Express가 담당합니다.

```powershell
cd ml-service
# .env 작성 (아래 환경변수)
pip install -r requirements.txt
playwright install chromium   # PDF 리포트(report/)용 — 1회만
python app.py
```

기본: `127.0.0.1:5000`

**Linux 배포 시 추가로 필요한 것** (Windows 개발 환경에는 해당 없음):
- `playwright install --with-deps chromium` — Chromium 실행에 필요한 시스템 공유 라이브러리(libnss3 등)까지 함께 설치
- 한글 폰트: `fonts-noto-cjk` 또는 `fonts-nanum` (apt) — 없으면 PDF의 한글이 네모(tofu)로 깨짐. `report/templates/wildfire_report.html.j2`의 폰트 스택이 `Noto Sans/Serif CJK KR` → `NanumGothic/Myeongjo`도 찾아보도록 되어 있으니 둘 중 하나만 설치해도 됨

## 환경변수 (`ml-service/.env`)

| 키 | 용도 |
|----|------|
| `KMA_API_AUTH_KEY` | 기상청 ASOS (당일 예측) |
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | MariaDB (산불 `forestfire_stats`, 기상 `weather_daily_sigungu`, 당일 스냅샷 `daily_ml_risk_*`) |
| `ML_HOST` | 기본 `127.0.0.1` |
| `ML_PORT` | 기본 `5000` |
| `FOREST_FIRE_SERVICE_KEY` | (선택) 레거시 OpenAPI ETL 스크립트용 — 웹 동기화에는 불필요 |
| `WEB_DATA_DIR`(선택) | CLI 당일예측 스냅샷(`daily_ml_risk.json`) 경로. 기본 `frontend/public/data` |

예측(`predict/daily.py` 등)은 `ml_paths.py`, `predict/kma_client.py`로 `etl/` 없이도 동작합니다.  
웹 산불이력 갱신은 Express(`POST /api/wildfires/sync`)가 처리합니다.  
챗봇·웹 리포트가 읽는 당일 스냅샷은 Express가 `backend/data/daily_ml_risk.json`에 저장합니다. Flask CLI(`python -m predict.daily`)가 남기는 파일은 위의 `WEB_DATA_DIR`입니다.

당일 KMA 예측이 끝나면 `predict/risk_snapshot_db.py`가 같은 MariaDB에  
`daily_ml_risk_runs` 1행 + `daily_ml_risk_regions`(시군구)를 UPSERT 합니다.  
스키마는 `backend/migrations/002_daily_ml_risk.sql`. 테이블이 없거나 `DB_*`가 비어 있으면 로그만 남기고 예측 응답은 막지 않습니다. **시나리오 예측은 DB에 넣지 않습니다.**

## 예측 시 기상 출처

| 구간 | 소스 |
|------|------|
| 예측일 당일 | 기상청 ASOS API |
| lag-1 · lag-2 (어제·그저께) | MariaDB `weather_daily_sigungu` (실패 시 CSV) |
| 사용자 지정 평년 | 같은 테이블에서 **선택한 달**의 전 기간·전국 시군구 일자료 평균. 연도는 평균에 넣지 않음 |
| 사용자 지정 프리셋 | 같은 달 분포의 10·90분위. 모드를 정의하는 변수만 분위, 나머지는 평년 (WMO ETCCDI 관례). 건조·강풍: 습도·강수 P10 · 바람 P90. 고온·건조: 기온 P90 · 습도·강수 P10. 습함·비 많음: 습도·강수 P90. DB 실패 시 코드의 월별 근사 표 + 가산치 폴백 |

`GET /predict/scenario/baseline?month=` 가 평년·프리셋 숫자를 돌려 주고, UI가 슬라이더를 채운 뒤 `POST /predict/scenario`에 `weather`를 넘깁니다. 월별 조회는 프로세스 메모리에 캐시합니다.

## 예측 엔진 (`predict/`)

라우트와 CLI가 같은 모듈을 씁니다.

```powershell
python -m predict.daily --kma
python -m predict.daily --date 2025-03-15
python -m predict.daily --date 2026-07-23 --temp-avg 28 --humidity-avg 45 --wind-avg 3.5 --precip 0
```

피처 (10): 기상 4 + 산불이력 2 + DWI + 강수파생 3  
(`precip_sum_7d`, `precip_sum_14d`, `dry_days` — 예측일 전일까지, 결측=0mm)  
확률: XGB raw `predict_proba` (보정 없음). 웹 화면의 산불위험지수 = `ml_risk × 100`.  
학습은 `etl/ml/train_wildfire_xgb.py`.

## PDF 리포트 (`report/`)

지역(시·도/시군구/전국) 단위 산불위험 PDF를 만듭니다. daily_ml_risk 예측 데이터 + Jinja2 템플릿을
Playwright(Chromium)로 인쇄해 **A4 가로(landscape)** PDF로 뽑습니다.  
첫 장은 표지(`AI 챗봇 · 당일 산불 예측 리포트` / 발행일·작성·닉네임 + 요약·대형 게이지), 이어서 기상·순위·시·도 비교 본문입니다.
여백·게이지·카드 간격을 줄여 표지 이후 내용이 빽빽하게 들어가도록 구성합니다.
전국 리포트의 시군구 순위는 **상위 10곳 + 하위 5곳**만 넣고, 시·도 비교는 전국 평균 기준선이 있는 가로 막대 차트로 표시합니다.

**웹에서는 Express가 회원 세션을 확인한 뒤** 이 서비스의 `POST /report/pdf` 를 호출합니다.
챗봇에서 지역명이 빠진 「PDF 만들어줘」는 Express `regionFocus`가 대화 히스토리로 지역을 채운 뒤 여기로 넘깁니다.
브라우저가 Flask를 직접 호출하지 마세요.

```powershell
python -m report.generate --region 서울
python -m report.generate --region "부산 중구"
```

## HTTP (내부)

| 메서드 | 경로 | 설명 |
|--------|------|------|
| `GET` | `/health` | 헬스 |
| `POST` | `/predict/daily` | 당일 예측 |
| `GET` | `/predict/scenario/baseline` | 월 평년·프리셋 기상 (`?month=1..12`) |
| `POST` | `/predict/scenario` | 가정 기상 시나리오 예측 |
| `POST` | `/report/pdf` | 지역별 산불위험 PDF (body: `{region}`) |

## 폴더 구조

```
ml-service/
├── app.py
├── config.py              # .env · HOST/PORT
├── ml_paths.py            # 예측용 경로
├── models/                # XGBoost JSON
├── reference/             # 시군구 hist · ASOS 매핑 CSV
├── requirements.txt
├── predict/
│   ├── daily.py
│   ├── weather_db.py      # MariaDB lag/학습 기상 · 월 평년·10/90분위
│   ├── fire_db.py         # MariaDB forestfire_stats
│   ├── risk_snapshot_db.py  # 당일 예측 → daily_ml_risk_runs / regions
│   ├── dwi.py · precip_features.py
│   ├── kma_client.py
│   └── scenario_weather.py  # 시나리오 평년·프리셋 → cli_weather
├── routes/
│   ├── health.py
│   ├── predict.py
│   └── report.py          # → report/generate
├── report/                # 지역별 PDF 리포트 (Jinja2 + Playwright)
│   ├── data.py · geometry.py · render.py · generate.py
│   └── templates/wildfire_report.html.j2
└── services/
    └── weather.py
```

런타임 모델은 `models/`, 시군구 lookup CSV는 `reference/` 를 읽습니다.
(Railway에서 Root Directory가 `ml-service`이면 이 폴더가 컨테이너 `/app`이 됩니다.)
