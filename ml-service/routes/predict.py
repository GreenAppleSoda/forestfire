"""당일·시나리오 예측 엔드포인트."""

from __future__ import annotations

import logging

from flask import Blueprint, jsonify, request

from services.weather import cli_weather_from_body, public_weather_source

bp = Blueprint("predict", __name__, url_prefix="/predict")
log = logging.getLogger("ml-service.predict")


@bp.post("/daily")
def predict_daily():
    from predict.daily import run_daily_predict

    body = request.get_json(silent=True) or {}
    source = (body.get("source") or "kma").lower()
    date = body.get("date")
    cli_wx = cli_weather_from_body(body)

    use_kma = False
    use_open_meteo = False
    if cli_wx is not None or source == "manual":
        if cli_wx is None:
            return jsonify({"ok": False, "error": "manual weather requires temp_avg"}), 400
    elif source == "open_meteo":
        use_open_meteo = True
    else:
        use_kma = True

    try:
        payload = run_daily_predict(
            date=date,
            cli_weather=cli_wx,
            use_kma=use_kma,
            use_open_meteo=use_open_meteo,
            write_file=True,
        )
        out = dict(payload)
        out["weather_source"] = public_weather_source(str(payload.get("weather_source", "")))
        log.info(
            "predict ok date=%s source=%s n=%s",
            out.get("predict_date"),
            out.get("weather_source"),
            out.get("n_regions"),
        )
        return jsonify({"ok": True, "data": out})
    except FileNotFoundError as e:
        log.exception("predict missing artifact")
        return jsonify({"ok": False, "error": "model_or_data_missing", "detail": str(e)}), 503
    except Exception as e:
        log.exception("predict failed")
        return jsonify({"ok": False, "error": "predict_failed", "detail": str(e)}), 500


@bp.post("/scenario")
def predict_scenario():
    """연·월 + 가정 기상 → 시군구 산불 확률 (사용자 지정 탭)."""
    from predict.daily import run_daily_predict
    from predict.scenario_weather import build_scenario

    body = request.get_json(silent=True) or {}
    try:
        year = int(body.get("year"))
        month = int(body.get("month"))
    except (TypeError, ValueError):
        return jsonify({"ok": False, "error": "year and month required"}), 400

    weather = body.get("weather") if isinstance(body.get("weather"), dict) else None
    preset = body.get("preset")

    try:
        scenario = build_scenario(
            year=year, month=month, weather=weather, preset=preset
        )
        payload = run_daily_predict(
            date=scenario["date"],
            cli_weather=scenario["cli_weather"],
            use_kma=False,
            use_open_meteo=False,
            write_file=False,
        )
        out = dict(payload)
        out["weather_source"] = "manual"
        summary = scenario["summary"]
        out["scenario_summary"] = summary
        out["note"] = "가정 시나리오 예측 확률 (실제 예보 아님) · " + summary
        log.info(
            "scenario ok date=%s n=%s summary=%s",
            out.get("predict_date"),
            out.get("n_regions"),
            summary,
        )
        return jsonify({"ok": True, "data": out})
    except ValueError as e:
        return jsonify({"ok": False, "error": "invalid_scenario", "detail": str(e)}), 400
    except FileNotFoundError as e:
        log.exception("scenario missing artifact")
        return jsonify({"ok": False, "error": "model_or_data_missing", "detail": str(e)}), 503
    except Exception as e:
        log.exception("scenario failed")
        return jsonify({"ok": False, "error": "predict_failed", "detail": str(e)}), 500
