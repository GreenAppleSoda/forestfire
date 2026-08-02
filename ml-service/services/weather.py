"""요청 본문·응답 라벨 변환 (Flask 라우트용)."""

from __future__ import annotations


def public_weather_source(raw: str) -> str:
    """내부 상세(타임스탬프 등)를 제거하고 UI용 라벨만 반환."""
    s = (raw or "").lower()
    if s.startswith("kma"):
        return "kma"
    if s.startswith("open_meteo"):
        return "open_meteo"
    if s.startswith("cli") or s.startswith("scenario"):
        return "manual"
    if s.startswith("local_csv"):
        return "local"
    return "unknown"


def cli_weather_from_body(body: dict) -> dict | None:
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
        "precip": float(w["precip"] if w.get("precip") is not None else 0),
        "wind_avg": float(w["wind_avg"] if w.get("wind_avg") is not None else 2.0),
        "humidity_avg": float(
            w["humidity_avg"] if w.get("humidity_avg") is not None else 50
        ),
    }
