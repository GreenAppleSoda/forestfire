"""사용자 지정(시나리오) 기상 — 월 평년 + 슬라이더 값 → cli_weather."""

from __future__ import annotations

from typing import Any

# 한국 월별 대략 평년 (전국 평균 근사) — 슬라이더 기본값
# temp_avg℃, humidity_avg%, wind_avg m/s, precip mm/day
MONTH_BASELINE: dict[int, dict[str, float]] = {
    1: {"temp_avg": 0.0, "humidity_avg": 58.0, "wind_avg": 2.4, "precip": 0.8},
    2: {"temp_avg": 2.0, "humidity_avg": 56.0, "wind_avg": 2.6, "precip": 1.0},
    3: {"temp_avg": 7.5, "humidity_avg": 55.0, "wind_avg": 2.8, "precip": 1.5},
    4: {"temp_avg": 13.5, "humidity_avg": 54.0, "wind_avg": 2.7, "precip": 2.5},
    5: {"temp_avg": 18.5, "humidity_avg": 58.0, "wind_avg": 2.4, "precip": 3.0},
    6: {"temp_avg": 22.5, "humidity_avg": 68.0, "wind_avg": 2.2, "precip": 5.5},
    7: {"temp_avg": 25.5, "humidity_avg": 76.0, "wind_avg": 2.1, "precip": 9.0},
    8: {"temp_avg": 26.0, "humidity_avg": 74.0, "wind_avg": 2.2, "precip": 8.0},
    9: {"temp_avg": 21.5, "humidity_avg": 68.0, "wind_avg": 2.3, "precip": 4.5},
    10: {"temp_avg": 15.0, "humidity_avg": 62.0, "wind_avg": 2.4, "precip": 2.0},
    11: {"temp_avg": 8.0, "humidity_avg": 60.0, "wind_avg": 2.5, "precip": 1.5},
    12: {"temp_avg": 2.0, "humidity_avg": 58.0, "wind_avg": 2.5, "precip": 1.0},
}

SLIDER_RANGES = {
    "temp_avg": {"min": -10, "max": 38, "step": 0.5},
    "humidity_avg": {"min": 15, "max": 95, "step": 1},
    "wind_avg": {"min": 0.5, "max": 12, "step": 0.1},
    "precip": {"min": 0, "max": 40, "step": 0.5},
}

# 프리셋: baseline 대비 가산 (월 무관 델타) 또는 absolute 키 혼용
PRESETS: dict[str, dict[str, Any]] = {
    "normal": {
        "label": "평년",
        "deltas": {"temp_avg": 0, "humidity_avg": 0, "wind_avg": 0, "precip": 0},
    },
    "dry_windy": {
        "label": "건조·강풍",
        "deltas": {"temp_avg": 2, "humidity_avg": -20, "wind_avg": 3.5, "precip": -1},
    },
    "hot_dry": {
        "label": "고온·건조",
        "deltas": {"temp_avg": 5, "humidity_avg": -25, "wind_avg": 1.5, "precip": -1},
    },
    "wet": {
        "label": "습함·비 많음",
        "deltas": {"temp_avg": -1, "humidity_avg": 15, "wind_avg": -0.5, "precip": 12},
    },
}


def clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


def month_baseline(month: int) -> dict[str, float]:
    m = int(month)
    if m < 1 or m > 12:
        raise ValueError("month must be 1..12")
    return dict(MONTH_BASELINE[m])


def apply_preset(month: int, preset_id: str) -> dict[str, float]:
    base = month_baseline(month)
    preset = PRESETS.get(preset_id) or PRESETS["normal"]
    deltas = preset["deltas"]
    out = {
        "temp_avg": base["temp_avg"] + float(deltas["temp_avg"]),
        "humidity_avg": base["humidity_avg"] + float(deltas["humidity_avg"]),
        "wind_avg": base["wind_avg"] + float(deltas["wind_avg"]),
        "precip": max(0.0, base["precip"] + float(deltas["precip"])),
    }
    return _clamp_weather(out)


def _clamp_weather(w: dict[str, float]) -> dict[str, float]:
    return {
        "temp_avg": clamp(w["temp_avg"], SLIDER_RANGES["temp_avg"]["min"], SLIDER_RANGES["temp_avg"]["max"]),
        "humidity_avg": clamp(
            w["humidity_avg"],
            SLIDER_RANGES["humidity_avg"]["min"],
            SLIDER_RANGES["humidity_avg"]["max"],
        ),
        "wind_avg": clamp(w["wind_avg"], SLIDER_RANGES["wind_avg"]["min"], SLIDER_RANGES["wind_avg"]["max"]),
        "precip": clamp(w["precip"], SLIDER_RANGES["precip"]["min"], SLIDER_RANGES["precip"]["max"]),
    }


def weather_to_cli(weather: dict[str, Any]) -> dict[str, float]:
    """슬라이더/요청 weather → predict.daily cli_weather."""
    if weather.get("temp_avg") is None:
        raise ValueError("temp_avg required")
    temp_avg = float(weather["temp_avg"])
    humidity_avg = float(
        weather["humidity_avg"] if weather.get("humidity_avg") is not None else 50
    )
    wind_avg = float(weather["wind_avg"] if weather.get("wind_avg") is not None else 2.0)
    precip = float(weather["precip"] if weather.get("precip") is not None else 0)

    temp_avg = clamp(temp_avg, SLIDER_RANGES["temp_avg"]["min"], SLIDER_RANGES["temp_avg"]["max"])
    humidity_avg = clamp(
        humidity_avg,
        SLIDER_RANGES["humidity_avg"]["min"],
        SLIDER_RANGES["humidity_avg"]["max"],
    )
    wind_avg = clamp(wind_avg, SLIDER_RANGES["wind_avg"]["min"], SLIDER_RANGES["wind_avg"]["max"])
    precip = clamp(precip, SLIDER_RANGES["precip"]["min"], SLIDER_RANGES["precip"]["max"])

    return {
        "temp_avg": round(temp_avg, 1),
        "precip": round(precip, 1),
        "wind_avg": round(wind_avg, 1),
        "humidity_avg": round(humidity_avg, 1),
    }


def summarize_weather(cli: dict[str, float], year: int, month: int) -> str:
    return (
        f"{year}년 {month}월 가정 · "
        f"기온 {cli['temp_avg']}℃ · 습도 {cli['humidity_avg']}% · "
        f"풍속 {cli['wind_avg']}m/s · 강수 {cli['precip']}mm"
    )


def scenario_defaults(year: int, month: int) -> dict[str, Any]:
    base = month_baseline(month)
    return {
        "year": year,
        "month": month,
        "baseline": base,
        "ranges": SLIDER_RANGES,
        "presets": [
            {"id": pid, "label": p["label"], "weather": apply_preset(month, pid)}
            for pid, p in PRESETS.items()
        ],
        "weather": apply_preset(month, "normal"),
    }


def build_scenario(
    *,
    year: int,
    month: int,
    weather: dict[str, Any] | None = None,
    preset: str | None = None,
) -> dict[str, Any]:
    """시나리오 예측용 date + cli_weather + 요약."""
    y = int(year)
    m = int(month)
    if m < 1 or m > 12:
        raise ValueError("month must be 1..12")
    if y < 2000 or y > 2100:
        raise ValueError("year out of range")

    if weather and weather.get("temp_avg") is not None:
        cli = weather_to_cli(weather)
    elif preset:
        cli = weather_to_cli(apply_preset(m, preset))
    else:
        cli = weather_to_cli(apply_preset(m, "normal"))

    date = f"{y:04d}-{m:02d}-15"
    return {
        "date": date,
        "cli_weather": cli,
        "summary": summarize_weather(cli, y, m),
        "year": y,
        "month": m,
    }
