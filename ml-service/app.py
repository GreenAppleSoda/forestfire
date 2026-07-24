"""
산불 당일 위험 예측 — Flask (내부 전용)

Express(server/)만 이 서비스를 호출한다. 브라우저에서 직접 열지 말 것.
기존 backend/ml/predict_daily_risk.py 로직을 재사용한다.
"""

from __future__ import annotations

import logging
import os
import sys
from pathlib import Path

from flask import Flask, jsonify, request

ROOT = Path(__file__).resolve().parent.parent
BACKEND = ROOT / "backend"
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

# ml-service/.env → 프로세스 env (KMA 키 등)
_ENV_FILE = Path(__file__).resolve().parent / ".env"


def _load_dotenv(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, val = line.split("=", 1)
        key = key.strip()
        val = val.strip().strip('"').strip("'")
        os.environ.setdefault(key, val)


_load_dotenv(_ENV_FILE)

from ml.predict_daily_risk import run_daily_predict  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s [ml-service] %(message)s")
log = logging.getLogger("ml-service")

app = Flask(__name__)

HOST = os.environ.get("ML_HOST", "127.0.0.1")
PORT = int(os.environ.get("ML_PORT", "5000"))


def _public_source(raw: str) -> str:
    """내부 상세(타임스탬프 등)를 제거하고 UI용 라벨만 반환."""
    s = (raw or "").lower()
    if s.startswith("kma"):
        return "kma"
    if s.startswith("open_meteo"):
        return "open_meteo"
    if s.startswith("cli"):
        return "manual"
    if s.startswith("local_csv"):
        return "local"
    return "unknown"


def _cli_weather_from_body(body: dict) -> dict | None:
    if body.get("temp_avg") is None and not (
        isinstance(body.get("weather"), dict) and body["weather"].get("temp_avg") is not None
    ):
        return None
    w = body.get("weather") if isinstance(body.get("weather"), dict) else body
    temp_avg = w.get("temp_avg")
    if temp_avg is None:
        return None
    return {
        "temp_avg": float(temp_avg),
        "temp_min": float(w["temp_min"] if w.get("temp_min") is not None else temp_avg - 5),
        "temp_max": float(w["temp_max"] if w.get("temp_max") is not None else temp_avg + 5),
        "precip": float(w["precip"] if w.get("precip") is not None else 0),
        "wind_avg": float(w["wind_avg"] if w.get("wind_avg") is not None else 2.0),
        "wind_max": float(w["wind_max"] if w.get("wind_max") is not None else 4.0),
        "humidity_avg": float(
            w["humidity_avg"] if w.get("humidity_avg") is not None else 50
        ),
        "humidity_min": float(
            w["humidity_min"] if w.get("humidity_min") is not None else 35
        ),
    }


@app.get("/health")
def health():
    return jsonify({"ok": True, "service": "ml-service"})


@app.post("/predict/daily")
def predict_daily():
    body = request.get_json(silent=True) or {}
    source = (body.get("source") or "kma").lower()
    date = body.get("date")
    cli_wx = _cli_weather_from_body(body)

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
        # Express가 다시 필터하지만, 내부 소스 문자열은 여기서도 정리
        out = dict(payload)
        out["weather_source"] = _public_source(str(payload.get("weather_source", "")))
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


if __name__ == "__main__":
    # 127.0.0.1 만 바인딩 — 외부 직접 접근 방지
    app.run(host=HOST, port=PORT, debug=False, threaded=True)
