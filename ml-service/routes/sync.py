"""산불 이력 동기화 — MariaDB forestfire_stats → 맵 갱신."""

from __future__ import annotations

import json
import logging

from flask import Blueprint, jsonify

bp = Blueprint("sync", __name__, url_prefix="/sync")
log = logging.getLogger("ml-service.sync")


@bp.get("/wildfires/status")
def sync_wildfires_status():
    from paths import WILDFIRE_OPENAPI_STATE

    if not WILDFIRE_OPENAPI_STATE.exists():
        return jsonify({"ok": True, "data": None})
    try:
        data = json.loads(WILDFIRE_OPENAPI_STATE.read_text(encoding="utf-8"))
        return jsonify(
            {
                "ok": True,
                "data": {
                    "last_sync_at": data.get("last_sync_at"),
                    "source": data.get("source"),
                    "fetched": data.get("fetched"),
                    "added": data.get("added"),
                    "refined_total": data.get("refined_total"),
                },
            }
        )
    except Exception:
        return jsonify({"ok": True, "data": None})


@bp.post("/wildfires")
def sync_wildfires():
    """MariaDB forestfire_stats → refined CSV → 이력 맵 갱신."""
    try:
        from pipeline.sync_wildfire_history import run_sync

        result = run_sync()
        public = {
            "last_sync_at": result.get("last_sync_at"),
            "source": result.get("source"),
            "fetched": result.get("fetched"),
            "added": result.get("added"),
            "refined_total": result.get("refined_total"),
            "map_refreshed": bool(result.get("map_refresh")),
        }
        log.info(
            "wildfire sync ok total=%s source=%s",
            public["refined_total"],
            public["source"],
        )
        return jsonify({"ok": True, "data": public})
    except RuntimeError as e:
        log.exception("wildfire sync config")
        return jsonify({"ok": False, "error": "config_error", "detail": str(e)}), 503
    except Exception as e:
        log.exception("wildfire sync failed")
        return jsonify({"ok": False, "error": "sync_failed", "detail": str(e)}), 500
