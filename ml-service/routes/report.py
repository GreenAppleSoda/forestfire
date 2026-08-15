"""지역별 산불위험 PDF 리포트 — 내부 전용. Express(backend/)가 챗봇 요청에 맞춰 호출."""

from __future__ import annotations

import logging
from urllib.parse import quote

from flask import Blueprint, jsonify, request, send_file

bp = Blueprint("report", __name__, url_prefix="/report")
log = logging.getLogger("ml-service.report")


@bp.post("/pdf")
def report_pdf():
    from report.data import build_context, load_payload
    from report.generate import DEFAULT_OUT_DIR
    from report.render import render_html, render_pdf

    body = request.get_json(silent=True) or {}
    region = (body.get("region") or "").strip()  # 빈 문자열 → 전국 종합 (data.resolve_target 참고)

    try:
        payload = load_payload()
    except FileNotFoundError as e:
        log.exception("report missing daily_ml_risk data")
        return jsonify({"ok": False, "error": "predict_data_missing", "detail": str(e)}), 503

    try:
        context = build_context(payload, region)
    except ValueError as e:
        # 지역을 못 찾았거나(resolve_target) 동명이인이라 모호한 경우
        return jsonify({"ok": False, "error": "invalid_region", "detail": str(e)}), 400

    try:
        html = render_html(context)
        DEFAULT_OUT_DIR.mkdir(parents=True, exist_ok=True)
        safe_name = context["title_label"].replace(" ", "_")
        out_path = DEFAULT_OUT_DIR / f"{safe_name}_{context['predict_date']}.pdf"
        pdf_path = render_pdf(
            html,
            out_path,
            title_label=context["title_label"],
            predict_date=context["predict_date"],
        )
    except Exception as e:
        log.exception("report render failed region=%s", region)
        return jsonify({"ok": False, "error": "report_failed", "detail": str(e)}), 500

    log.info("report ok region=%s -> %s path=%s", region, context["title_label"], pdf_path)
    resp = send_file(
        pdf_path,
        mimetype="application/pdf",
        as_attachment=True,
        download_name=pdf_path.name,
    )
    # Express가 표시용 지역 라벨·파일명을 다시 읽어갈 수 있도록 헤더로 노출
    resp.headers["X-Report-Region"] = quote(context["title_label"])
    resp.headers["X-Report-Filename"] = quote(pdf_path.name)
    resp.headers["Access-Control-Expose-Headers"] = "X-Report-Region, X-Report-Filename"
    return resp
