"""헬스체크."""

from __future__ import annotations

from flask import Blueprint, jsonify

bp = Blueprint("health", __name__)


@bp.get("/health")
def health():
    return jsonify({"ok": True, "service": "ml-service"})
