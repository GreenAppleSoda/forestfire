"""
날짜 + 날씨 → 시군구별 산불 발생 위험 예측 (XGBoost)

사용 예 (ml-service 디렉터리에서):
  python -m predict.daily --kma
  python -m predict.daily --date 2025-03-15
  python -m predict.daily --date 2026-07-23 \\
    --temp-avg 28 --humidity-avg 45 --wind-avg 3.5 --precip 0

feature: 사용자 입력 기상 4개 + 시군구 산불이력 2개 + DWI + SPI

출력: frontend/public/data/daily_ml_risk.json
"""

from __future__ import annotations

import sys
from pathlib import Path

_SERVICE_DIR = Path(__file__).resolve().parents[1]
_ETL_DIR = _SERVICE_DIR.parent / "etl"
for _p in (_SERVICE_DIR, _ETL_DIR):
    if str(_p) not in sys.path:
        sys.path.insert(0, str(_p))

import argparse
import json
import math
import urllib.parse
import urllib.request

import pandas as pd
from xgboost import XGBClassifier

from paths import (
    DAILY_ML_RISK,
    ROOT,
    SIGUNGU_ASOS_STATION,
    SIGUNGU_HIST_STATE,
    SPI_DAILY_SIGUNGU,
    WEATHER_DAILY_SIGUNGU,
    WILDFIRE_XGB_BUNDLE,
    WILDFIRE_XGB_MODEL,
    ensure_dirs,
)
from predict.dwi import compute_dwi

# ASOS 주요 지점 대략 좌표 (Open-Meteo용)
ASOS_COORDS: dict[int, tuple[float, float]] = {
    90: (38.2509, 128.5647),
    93: (37.9474, 127.7547),
    95: (38.1479, 127.3042),
    98: (37.9019, 127.0607),
    99: (37.8859, 126.7665),
    100: (37.6771, 128.7183),
    101: (37.9026, 127.7357),
    102: (37.9667, 124.6300),
    104: (37.8046, 128.8554),
    105: (37.7515, 128.8910),
    106: (37.5071, 129.1243),
    108: (37.5714, 126.9658),
    112: (37.4777, 126.6249),
    114: (37.3375, 127.9466),
    115: (37.4813, 130.8986),
    119: (37.2723, 126.9853),
    121: (37.1813, 128.4574),
    127: (36.9705, 127.9525),
    129: (36.7766, 126.4939),
    130: (36.9918, 129.4128),
    131: (36.6392, 127.4407),
    133: (36.3720, 127.3721),
    135: (36.2202, 127.9946),
    136: (36.5729, 128.7073),
    137: (36.4084, 128.1574),
    138: (36.0326, 129.3800),
    140: (35.9994, 126.7614),
    143: (35.8779, 128.6522),
    146: (35.8409, 127.1172),
    152: (35.5824, 129.3347),
    155: (35.1702, 128.5728),
    156: (35.1729, 126.8916),
    159: (35.1047, 129.0320),
    162: (34.8454, 128.4356),
    165: (34.8169, 126.3812),
    168: (34.7393, 127.7406),
    169: (34.6872, 125.4510),
    170: (34.3959, 126.7018),
    172: (35.3483, 126.5990),
    174: (35.0204, 127.3694),
    177: (36.6576, 126.6877),
    181: (36.6396, 127.4400),
    184: (33.5141, 126.5297),
    185: (33.2938, 126.1628),
    188: (33.3868, 126.8802),
    189: (33.2462, 126.5653),
    192: (35.1638, 128.0400),
    201: (37.7073, 126.4463),
    202: (37.4886, 127.4946),
    203: (37.2640, 127.4842),
    211: (38.0599, 128.1671),
    212: (37.6836, 127.8804),
    216: (37.1704, 128.9893),
    217: (37.3778, 128.6730),
    221: (37.1593, 128.1943),
    226: (36.4876, 127.7342),
    232: (36.7794, 127.1213),
    235: (36.3272, 126.5574),
    236: (36.2724, 126.9208),
    238: (36.0058, 127.4819),
    239: (36.4852, 127.2444),
    243: (35.7296, 126.7166),
    244: (35.6125, 127.2859),
    245: (35.5630, 126.8661),
    247: (35.4213, 127.3969),
    248: (35.6573, 127.5203),
    251: (35.3483, 126.5990),
    252: (35.2754, 126.4778),
    253: (35.2298, 128.8900),
    254: (35.3745, 127.1374),
    255: (35.2264, 128.6726),
    257: (35.3160, 129.0200),
    258: (34.7633, 127.0800),
    259: (34.6182, 126.7672),
    260: (34.6889, 126.9197),
    261: (34.5536, 126.5694),
    262: (34.6183, 127.2758),
    263: (35.3222, 128.2617),
    264: (35.5204, 127.7253),
    266: (34.9744, 127.5892),
    268: (34.4720, 126.2636),
    271: (36.9436, 128.9147),
    272: (36.8716, 128.5169),
    273: (36.6273, 128.1488),
    276: (36.4351, 129.0571),
    277: (36.5305, 129.4093),
    278: (36.3561, 128.6886),
    279: (36.1306, 128.3206),
    281: (35.9774, 128.9514),
    283: (35.8685, 129.2247),
    284: (35.6713, 127.9099),
    285: (35.5651, 128.1699),
    288: (35.4914, 128.7441),
    289: (35.4130, 127.8791),
    294: (34.8882, 128.6045),
    295: (34.8166, 127.9264),
    296: (35.1047, 129.0320),
}

FEATURE_COLS = [
    "temp_avg",
    "precip",
    "wind_avg",
    "humidity_avg",
    "hist_fire_rate",
    "hist_fire_count_365",
    "dwi",
    "spi",
]

_weather_lag_index: dict[str, dict[pd.Timestamp, tuple[float | None, float | None]]] | None = None
_spi_index: dict[tuple[str, str], float] | None = None
_spi_day_cache: dict[str, dict[str, float]] = {}


def _ensure_spi_index() -> dict[tuple[str, str], float]:
    """(sigungu_code, YYYY-MM-DD) → spi (학습용·과거 CSV 매핑본)."""
    global _spi_index
    if _spi_index is not None:
        return _spi_index
    idx: dict[tuple[str, str], float] = {}
    if SPI_DAILY_SIGUNGU.exists():
        s = pd.read_csv(
            SPI_DAILY_SIGUNGU,
            encoding="utf-8-sig",
            usecols=["date", "sigungu_code", "spi"],
        )
        s["sigungu_code"] = s["sigungu_code"].astype(str)
        for r in s.itertuples(index=False):
            d = str(r.date)[:10]
            idx[(str(r.sigungu_code), d)] = float(r.spi)
    else:
        try:
            from predict.spi import build_spi_daily_sigungu

            build_spi_daily_sigungu()
            return _ensure_spi_index()
        except Exception:
            pass
    _spi_index = idx
    return idx


def _historical_spi_by_code(date: str) -> dict[str, float]:
    idx = _ensure_spi_index()
    d = str(date)[:10]
    return {code: v for (code, dd), v in idx.items() if dd == d}


def _realtime_spi_by_code(date: str) -> dict[str, float]:
    """기상청 API + 강수 CSV로 당일 SPI → 시군구 코드 맵."""
    from datetime import datetime

    from predict.daily_spi_realtime import compute_spi_by_station

    d = str(date)[:10]
    today = pd.Timestamp.now(tz="Asia/Seoul").strftime("%Y-%m-%d")
    if d == today:
        as_of = datetime.now().replace(minute=0, second=0, microsecond=0)
    else:
        as_of = datetime.strptime(d + "1500", "%Y%m%d%H%M")

    assign = pd.read_csv(SIGUNGU_ASOS_STATION, encoding="utf-8-sig")
    assign["sigungu_code"] = assign["sigungu_code"].astype(str)
    assign["stn_id"] = assign["stn_id"].astype(int)
    stn_ids = sorted(assign["stn_id"].unique().tolist())

    stn_spi = compute_spi_by_station(
        as_of=as_of,
        station_ids=stn_ids,
        quiet=True,
    )
    out: dict[str, float] = {}
    for _, r in assign.iterrows():
        sid = int(r["stn_id"])
        if sid in stn_spi:
            out[str(r["sigungu_code"])] = stn_spi[sid]
    return out


def _spi_map_for_predict(date: str, *, use_realtime: bool) -> dict[str, float]:
    """시군구→SPI. 과거 매핑본 + (옵션) realtime 당일 계산 덮어쓰기."""
    d = str(date)[:10]
    cache_key = f"{d}|rt={int(use_realtime)}"
    if cache_key in _spi_day_cache:
        return _spi_day_cache[cache_key]

    out = _historical_spi_by_code(d)
    if use_realtime:
        try:
            out.update(_realtime_spi_by_code(d))
        except Exception:
            # API/패키지 실패 시 과거 SPI·0.0 폴백
            pass
    _spi_day_cache[cache_key] = out
    return out


def _lookup_spi(date: str, code: str, spi_by_code: dict[str, float] | None = None) -> float:
    """해당일 SPI. 없으면 0.0(Near normal 근사)."""
    if spi_by_code is not None and str(code) in spi_by_code:
        return float(spi_by_code[str(code)])
    idx = _ensure_spi_index()
    d = str(date)[:10]
    v = idx.get((str(code), d))
    if v is None:
        return 0.0
    return float(v)


def _ensure_lag_index() -> dict[str, dict[pd.Timestamp, tuple[float | None, float | None]]]:
    """sigungu_code → {date → (humidity_avg, precip)}."""
    global _weather_lag_index
    if _weather_lag_index is not None:
        return _weather_lag_index

    idx: dict[str, dict[pd.Timestamp, tuple[float | None, float | None]]] = {}
    if WEATHER_DAILY_SIGUNGU.exists():
        w = pd.read_csv(
            WEATHER_DAILY_SIGUNGU,
            encoding="utf-8-sig",
            usecols=["date", "sigungu_code", "humidity_avg", "precip"],
        )
        w["sigungu_code"] = w["sigungu_code"].astype(str)
        w["date"] = pd.to_datetime(w["date"]).dt.normalize()
        for r in w.itertuples(index=False):
            hum = r.humidity_avg
            pr = r.precip
            if hum is not None and isinstance(hum, float) and math.isnan(hum):
                hum = None
            elif hum is not None:
                hum = float(hum)
            if pr is None or (isinstance(pr, float) and math.isnan(pr)):
                pr = None
            else:
                pr = float(pr)
            bucket = idx.setdefault(str(r.sigungu_code), {})
            bucket[pd.Timestamp(r.date)] = (hum, pr)
    _weather_lag_index = idx
    return idx


def _lag_weather_lookup(date: str, code: str) -> dict[str, float | None]:
    """1·2일전 습도·강수. 없으면 None → compute_dwi가 당일로 대체."""
    idx = _ensure_lag_index()
    by_date = idx.get(str(code), {})
    dt = pd.Timestamp(date).normalize()
    d1 = dt - pd.Timedelta(days=1)
    d2 = dt - pd.Timedelta(days=2)
    h1, p1 = by_date.get(d1, (None, None))
    h2, p2 = by_date.get(d2, (None, None))
    return {
        "humidity_lag1": h1,
        "humidity_lag2": h2,
        "precip_lag1": p1,
        "precip_lag2": p2,
    }


def build_features_for_day(
    date: str,
    weather_by_code: dict[str, dict],
    regions: pd.DataFrame,
    spi_by_code: dict[str, float] | None = None,
) -> pd.DataFrame:
    """시군구별 feature 행렬 (기상 4 + 이력 2 + DWI + SPI)."""
    month = int(pd.Timestamp(date).month)
    rows = []
    for _, h in regions.iterrows():
        code = str(h["sigungu_code"])
        w = weather_by_code.get(code)
        if not w:
            continue
        temp_avg = float(w["temp_avg"])
        precip = float(w.get("precip") or 0)
        wind_avg = float(w["wind_avg"])
        humidity_avg = float(w["humidity_avg"])
        lags = _lag_weather_lookup(date, code)
        dwi = compute_dwi(
            temp_avg=temp_avg,
            humidity_avg=humidity_avg,
            wind_avg=wind_avg,
            precip=precip,
            month=month,
            humidity_lag1=lags["humidity_lag1"],
            humidity_lag2=lags["humidity_lag2"],
            precip_lag1=lags["precip_lag1"],
            precip_lag2=lags["precip_lag2"],
        )
        rows.append(
            {
                "sigungu_code": code,
                "sigungu_name": h["sigungu_name"],
                "province": h["province"],
                "temp_avg": temp_avg,
                "precip": precip,
                "wind_avg": wind_avg,
                "humidity_avg": humidity_avg,
                "hist_fire_rate": float(h["hist_fire_rate"]),
                "hist_fire_count_365": float(h["hist_fire_count_365"]),
                "dwi": dwi,
                "spi": _lookup_spi(date, code, spi_by_code),
            }
        )
    return pd.DataFrame(rows)


def fetch_open_meteo(lat: float, lon: float, date: str) -> dict | None:
    qs = urllib.parse.urlencode(
        {
            "latitude": lat,
            "longitude": lon,
            "start_date": date,
            "end_date": date,
            "daily": ",".join(
                [
                    "temperature_2m_mean",
                    "precipitation_sum",
                    "wind_speed_10m_mean",
                    "relative_humidity_2m_mean",
                ]
            ),
            "timezone": "Asia/Seoul",
        }
    )
    url = f"https://archive-api.open-meteo.com/v1/archive?{qs}"
    # 최근/오늘은 forecast API
    today = pd.Timestamp.now(tz="Asia/Seoul").strftime("%Y-%m-%d")
    if date >= today:
        url = f"https://api.open-meteo.com/v1/forecast?{qs}"
    try:
        with urllib.request.urlopen(url, timeout=20) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        d = data.get("daily") or {}
        if not d.get("time"):
            return None

        def g(key: str, default=math.nan):
            arr = d.get(key) or [default]
            v = arr[0]
            return float(v) if v is not None else default

        # open-meteo wind: km/h → m/s
        wind_avg = g("wind_speed_10m_mean")
        if not math.isnan(wind_avg):
            wind_avg /= 3.6
        return {
            "temp_avg": g("temperature_2m_mean"),
            "precip": g("precipitation_sum", 0.0),
            "wind_avg": wind_avg,
            "humidity_avg": g("relative_humidity_2m_mean"),
        }
    except Exception:
        return None


def weather_from_cli(args: argparse.Namespace) -> dict | None:
    if args.temp_avg is None:
        return None
    return {
        "temp_avg": float(args.temp_avg),
        "precip": float(args.precip if args.precip is not None else 0),
        "wind_avg": float(args.wind_avg if args.wind_avg is not None else 2.0),
        "humidity_avg": float(args.humidity_avg if args.humidity_avg is not None else 50),
    }


def load_regions() -> pd.DataFrame:
    h = pd.read_csv(SIGUNGU_HIST_STATE, encoding="utf-8-sig")
    h["sigungu_code"] = h["sigungu_code"].astype(str)
    return h


def _map_station_weather(
    assign: pd.DataFrame,
    stn_wx: dict[int, dict],
    hist: pd.DataFrame,
) -> dict[str, dict]:
    default = stn_wx.get(108) or next(iter(stn_wx.values()))
    out: dict[str, dict] = {}
    for _, r in assign.iterrows():
        sid = int(r["stn_id"])
        out[str(r["sigungu_code"])] = dict(stn_wx.get(sid, default))
    # assign에 없는 시군구도 hist 기준으로 채움
    for code in hist["sigungu_code"].astype(str):
        if code not in out:
            out[code] = dict(default)
    return out


def resolve_weather(
    date: str,
    cli_weather: dict | None,
    use_kma: bool,
    use_open_meteo: bool,
) -> tuple[str, dict[str, dict], str]:
    """반환: (실제 예측일, sigungu_code→weather, source label)"""
    hist = load_regions()
    assign = pd.read_csv(SIGUNGU_ASOS_STATION, encoding="utf-8-sig")
    assign["sigungu_code"] = assign["sigungu_code"].astype(str)

    # 1) CLI 동일 기상
    if cli_weather:
        out = {str(c): dict(cli_weather) for c in hist["sigungu_code"]}
        return date, out, "cli_uniform_weather"

    # 2) 기상청 ASOS (시간자료 우선, 없으면 일자료)
    if use_kma:
        from kma_asos_client import fetch_now_weather_by_station

        obs_date, stn_wx, src = fetch_now_weather_by_station()
        # 요청일이 오늘이 아니면 일자료 API로 재조회
        today = pd.Timestamp.now(tz="Asia/Seoul").strftime("%Y-%m-%d")
        if date != today and date != obs_date:
            from kma_asos_client import fetch_daily

            tm = date.replace("-", "")
            daily_rows = fetch_daily(tm=tm, stn=0)
            stn_wx = {}
            for d in daily_rows:
                if d.get("temp_avg") is None:
                    continue
                stn_wx[int(d["stn_id"])] = {
                    "temp_avg": float(d["temp_avg"]),
                    "precip": float(d["precip"] or 0),
                    "wind_avg": float(d["wind_avg"] or 0),
                    "humidity_avg": float(
                        d["humidity_avg"] if d["humidity_avg"] is not None else 50
                    ),
                }
            if not stn_wx:
                raise RuntimeError(f"기상청 일자료에 {date} 관측이 없습니다.")
            src = f"kma_daily:{tm}"
            obs_date = date
        out = _map_station_weather(assign, stn_wx, hist)
        return obs_date, out, src

    # 3) 저장된 시군구 일기상
    if WEATHER_DAILY_SIGUNGU.exists():
        wdf = pd.read_csv(WEATHER_DAILY_SIGUNGU, encoding="utf-8-sig")
        wdf["sigungu_code"] = wdf["sigungu_code"].astype(str)
        day = wdf[wdf["date"] == date]
        if len(day):
            out = {}
            for _, r in day.iterrows():
                out[str(r["sigungu_code"])] = {
                    "temp_avg": r["temp_avg"],
                    "precip": 0 if pd.isna(r["precip"]) else r["precip"],
                    "wind_avg": r["wind_avg"],
                    "humidity_avg": r["humidity_avg"],
                }
            return date, out, f"local_csv:{date}"

    # 4) Open-Meteo (지점별)
    if use_open_meteo:
        stn_wx = {}
        for stn_id, (lat, lon) in ASOS_COORDS.items():
            wx = fetch_open_meteo(lat, lon, date)
            if wx:
                stn_wx[stn_id] = wx
        if not stn_wx:
            raise RuntimeError("Open-Meteo에서 날씨를 가져오지 못했습니다.")
        out = _map_station_weather(assign, stn_wx, hist)
        return date, out, f"open_meteo:{date}"

    raise RuntimeError(
        "날씨 데이터가 없습니다. --kma / 날씨 인자 / --open-meteo / CSV 날짜를 확인하세요."
    )


def run_daily_predict(
    *,
    date: str | None = None,
    cli_weather: dict | None = None,
    use_kma: bool = False,
    use_open_meteo: bool = False,
    write_file: bool = True,
) -> dict:
    """당일 시군구 산불 위험 예측. Flask / CLI 공통 진입점."""
    ensure_dirs()
    if not WILDFIRE_XGB_MODEL.exists():
        raise FileNotFoundError(
            f"{WILDFIRE_XGB_MODEL} 없음. 먼저 python etl/ml/train_wildfire_xgb.py 실행"
        )
    if not SIGUNGU_HIST_STATE.exists():
        raise FileNotFoundError(str(SIGUNGU_HIST_STATE))

    req_date = date or pd.Timestamp.now(tz="Asia/Seoul").strftime("%Y-%m-%d")
    # 기본: 날씨 인자 없으면 기상청 ASOS
    if cli_weather is not None:
        use_kma = False
    elif not use_kma and not use_open_meteo:
        use_kma = True

    pred_date, weather_by_code, source = resolve_weather(
        req_date, cli_weather, use_kma, use_open_meteo
    )

    today = pd.Timestamp.now(tz="Asia/Seoul").strftime("%Y-%m-%d")
    # 기상청 당일(또는 오늘) 예측 → realtime SPI, 그 외·시나리오는 과거 매핑본
    use_realtime_spi = bool(use_kma) or (pred_date == today and cli_weather is None)
    spi_by_code = _spi_map_for_predict(pred_date, use_realtime=use_realtime_spi)

    hist = load_regions()
    feats = build_features_for_day(
        pred_date, weather_by_code, hist, spi_by_code=spi_by_code
    )
    feats = feats.dropna(subset=FEATURE_COLS)

    model = XGBClassifier()
    model.load_model(str(WILDFIRE_XGB_MODEL))
    proba = model.predict_proba(feats[FEATURE_COLS])[:, 1]
    feats = feats.copy()
    feats["y_prob"] = proba

    mn, mx = float(feats["y_prob"].min()), float(feats["y_prob"].max())
    feats["ml_risk_norm"] = (feats["y_prob"] - mn) / (mx - mn + 1e-12)

    bundle = {}
    if WILDFIRE_XGB_BUNDLE.exists():
        bundle = json.loads(WILDFIRE_XGB_BUNDLE.read_text(encoding="utf-8"))

    sample_code = "11110" if "11110" in weather_by_code else next(iter(weather_by_code))
    sample_wx = weather_by_code[sample_code]

    payload = {
        "predict_date": pred_date,
        "weather_source": source,
        "sample_weather": {
            k: round(float(v), 2) if v == v else None for k, v in sample_wx.items()
        },
        "model_metrics": bundle.get("metrics", {}),
        "n_regions": int(len(feats)),
        "note": "y_prob=당일 산불 발생 예측확률 · ml_risk_norm=지도 색용 정규화 (기상4 + 이력2 + DWI + SPI)",
        "regions": [
            {
                "code": str(r["sigungu_code"]),
                "name": r["sigungu_name"],
                "province": r["province"],
                "ml_risk": round(float(r["y_prob"]), 6),
                "ml_risk_norm": round(float(r["ml_risk_norm"]), 4),
                "humidity_avg": round(float(r["humidity_avg"]), 1),
                "temp_avg": round(float(r["temp_avg"]), 1),
                "precip": round(float(r["precip"]), 1),
                "wind_avg": round(float(r["wind_avg"]), 1),
            }
            for _, r in feats.sort_values("y_prob", ascending=False).iterrows()
        ],
    }
    if write_file:
        DAILY_ML_RISK.parent.mkdir(parents=True, exist_ok=True)
        DAILY_ML_RISK.write_text(
            json.dumps(payload, ensure_ascii=False), encoding="utf-8"
        )
    return payload


def main() -> None:
    parser = argparse.ArgumentParser(description="당일 산불 위험 예측")
    parser.add_argument(
        "--date",
        default=pd.Timestamp.now(tz="Asia/Seoul").strftime("%Y-%m-%d"),
        help="예측 날짜 YYYY-MM-DD (기본: 오늘)",
    )
    parser.add_argument("--temp-avg", type=float, default=None)
    parser.add_argument("--precip", type=float, default=None)
    parser.add_argument("--wind-avg", type=float, default=None)
    parser.add_argument("--humidity-avg", type=float, default=None)
    parser.add_argument(
        "--kma",
        action="store_true",
        default=False,
        help="기상청 ASOS API(시간/일자료)로 기상 조회",
    )
    parser.add_argument(
        "--open-meteo",
        action="store_true",
        default=False,
        help="Open-Meteo로 지점 날씨 조회",
    )
    parser.add_argument("--no-open-meteo", action="store_true")
    args = parser.parse_args()
    if args.no_open_meteo:
        args.open_meteo = False

    cli_wx = weather_from_cli(args)
    use_kma = bool(args.kma) or (cli_wx is None and not args.open_meteo)
    if cli_wx is not None:
        use_kma = False

    print(f"요청일: {args.date}")
    payload = run_daily_predict(
        date=args.date,
        cli_weather=cli_wx,
        use_kma=use_kma,
        use_open_meteo=bool(args.open_meteo),
        write_file=True,
    )
    print(f"예측일: {payload['predict_date']}")
    print(f"기상 출처: {payload['weather_source']} / 시군구 {payload['n_regions']}개")
    print(f"저장: {DAILY_ML_RISK}")
    print("상위 8개:")
    for r in payload["regions"][:8]:
        print(
            f"  {r['name']} ({r['province']}) "
            f"prob={r['ml_risk']:.4f} humid={r['humidity_avg']} temp={r['temp_avg']}"
        )


if __name__ == "__main__":
    main()
