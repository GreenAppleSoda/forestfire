"""리포트 생성 진입점.

사용 예 (ml-service 디렉터리에서):
  python -m report.generate --region 서울
  python -m report.generate --region "부산 중구" --out out/busan-junggu.pdf

챗봇 백엔드에서는 generate_report()를 직접 import해서 쓰면 된다:
  from report.generate import generate_report
  pdf_path = generate_report("노원구")
"""

from __future__ import annotations

import sys
from pathlib import Path

_SERVICE_DIR = Path(__file__).resolve().parents[1]
if str(_SERVICE_DIR) not in sys.path:
    sys.path.insert(0, str(_SERVICE_DIR))

import argparse

from report.data import build_context, load_payload
from report.render import render_html, render_pdf

DEFAULT_OUT_DIR = _SERVICE_DIR / "db" / "output" / "reports"


def generate_report(
    region: str,
    *,
    payload: dict | None = None,
    data_path: str | Path | None = None,
    out_path: str | Path | None = None,
) -> Path:
    """지역명(시·도 또는 시군구) → PDF 경로.

    region: "서울" / "노원구" / "부산 중구" (동명 시군구가 여러 시·도에 있으면
            시·도를 붙여 구분). data.resolve_target() 참고.
    payload: predict.daily.run_daily_predict()의 반환값을 그대로 넘기면 실시간
             예측 기준으로 만든다. 생략하면 data_path(기본 daily_ml_risk.json 캐시
             파일)에서 읽는다.
    """
    data = payload if payload is not None else load_payload(data_path)
    context = build_context(data, region)

    if out_path is None:
        safe_name = context["title_label"].replace(" ", "_")
        DEFAULT_OUT_DIR.mkdir(parents=True, exist_ok=True)
        out_path = DEFAULT_OUT_DIR / f"{safe_name}_{context['predict_date']}.pdf"

    html = render_html(context)
    return render_pdf(
        html,
        out_path,
        title_label=context["title_label"],
        predict_date=context["predict_date"],
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="지역별 산불위험 PDF 리포트 생성")
    parser.add_argument("--region", required=True, help="시·도 또는 시군구명 (예: 서울, '부산 중구')")
    parser.add_argument("--data", default=None, help="daily_ml_risk.json 경로 (생략 시 기본 경로)")
    parser.add_argument("--out", default=None, help="출력 PDF 경로 (생략 시 자동 생성)")
    args = parser.parse_args()

    path = generate_report(args.region, data_path=args.data, out_path=args.out)
    print(f"저장: {path}")


if __name__ == "__main__":
    main()
