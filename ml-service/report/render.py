"""HTML(Jinja2) → PDF(Playwright/Chromium) 렌더링.

사전 준비 (ml-service 가상환경에서 1회):
  pip install playwright
  playwright install chromium
"""

from __future__ import annotations

import tempfile
from pathlib import Path

from jinja2 import Environment, FileSystemLoader, select_autoescape

_TEMPLATES_DIR = Path(__file__).resolve().parent / "templates"

_env = Environment(
    loader=FileSystemLoader(str(_TEMPLATES_DIR)),
    autoescape=select_autoescape(["html", "j2"]),
)


def render_html(context: dict, template_name: str = "wildfire_report.html.j2") -> str:
    template = _env.get_template(template_name)
    return template.render(**context)


def _header_footer(title_label: str, predict_date: str) -> tuple[str, str]:
    """Playwright page.pdf()의 header/footer는 별도 격리 컨텍스트라 인라인 스타일만 먹는다."""
    font = '"Noto Sans KR", "Noto Sans CJK KR", sans-serif'
    header = f"""
    <div style="font-size:9px; width:100%; padding:0 40px; color:#6b7280;
                display:flex; justify-content:space-between; font-family:{font};">
      <span>산불발생위험도 보고서</span>
      <span>{predict_date}</span>
    </div>
    """
    footer = f"""
    <div style="font-size:9px; width:100%; padding:0 40px; color:#6b7280;
                display:flex; justify-content:flex-end; font-family:{font};">
      <span class="pageNumber"></span>&nbsp;/&nbsp;<span class="totalPages"></span>
    </div>
    """
    return header, footer


def render_pdf(
    html: str,
    out_path: str | Path,
    *,
    title_label: str,
    predict_date: str,
) -> Path:
    """HTML 문자열 → PDF 파일.

    리포트 생성은 챗봇 요청 빈도로 볼 때 핫패스가 아니므로, 매 호출마다 Chromium을
    새로 띄우고 끈다(스레드 안전성이 필요 없어 구현이 단순해진다). 초당 여러 건을
    찍어내야 하면 이 함수 대신 브라우저 인스턴스를 재사용하도록 바꿔라.
    """
    from playwright.sync_api import sync_playwright

    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    header_html, footer_html = _header_footer(title_label, predict_date)

    with sync_playwright() as p:
        # --no-sandbox: 컨테이너에서 root로 띄울 때 흔한 launch 실패를 막는다.
        # 렌더링 대상이 우리가 만든 HTML(신뢰 콘텐츠)뿐이라 안전하다.
        browser = p.chromium.launch(args=["--no-sandbox"])
        try:
            page = browser.new_page()
            page.set_content(html, wait_until="networkidle")
            page.evaluate("() => document.fonts.ready")
            page.pdf(
                path=str(out_path),
                format="A4",
                print_background=True,
                display_header_footer=True,
                header_template=header_html,
                footer_template=footer_html,
                margin={"top": "60px", "bottom": "40px", "left": "0px", "right": "0px"},
            )
        finally:
            browser.close()
    return out_path


def render_pdf_bytes(html: str, *, title_label: str, predict_date: str) -> bytes:
    """파일을 남기지 않고 PDF bytes를 바로 돌려준다 (Flask send_file / 챗봇 첨부용)."""
    with tempfile.TemporaryDirectory() as td:
        tmp_path = Path(td) / "report.pdf"
        render_pdf(html, tmp_path, title_label=title_label, predict_date=predict_date)
        return tmp_path.read_bytes()
