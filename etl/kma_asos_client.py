"""
기상청 API 허브 — 종관기상관측(ASOS) 시간/일 자료 조회·파싱

시간자료: kma_sfctm2.php  (tm 생략 = 현재시각)
일자료:   kma_sfcdd.php   (tm=YYYYMMDD)
"""

from __future__ import annotations

import os
import re
import urllib.parse
import urllib.request
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from paths import FRONTEND_ENV_LOCAL, ML_SERVICE_ENV

KST = ZoneInfo("Asia/Seoul")

HOURLY_URL = "https://apihub.kma.go.kr/api/typ01/url/kma_sfctm2.php"
DAILY_URL = "https://apihub.kma.go.kr/api/typ01/url/kma_sfcdd.php"

# 결측 코드
MISS = {-9, -9.0, -99, -99.0, -999, -999.0}


def _read_env_key(env_path: Path, name: str = "KMA_API_AUTH_KEY") -> str:
    if not env_path.exists():
        return ""
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line.startswith(f"{name}="):
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    return ""


def _auth_key() -> str:
    key = (
        os.environ.get("KMA_API_AUTH_KEY")
        or os.environ.get("KMA_AUTH_KEY")
        or ""
    ).strip()
    if not key:
        # ml-service/.env 우선, 하위 호환으로 frontend/.env.local
        key = _read_env_key(ML_SERVICE_ENV) or _read_env_key(FRONTEND_ENV_LOCAL)
    if not key:
        raise RuntimeError(
            "KMA_API_AUTH_KEY 가 없습니다. ml-service/.env 에 "
            "KMA_API_AUTH_KEY=발급키 를 넣어 주세요."
        )
    return key


def _get(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": "wildfire-atlas/1.0"})
    with urllib.request.urlopen(req, timeout=45) as resp:
        raw = resp.read()
    for enc in ("cp949", "euc-kr", "utf-8"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode("cp949", errors="replace")


def _f(tok: str) -> float | None:
    try:
        v = float(tok)
    except ValueError:
        return None
    if v in MISS:
        return None
    return v


def _i(tok: str) -> int | None:
    try:
        v = int(float(tok))
    except ValueError:
        return None
    if v in MISS:
        return None
    return v


def fetch_hourly(stn: int | str = 0, tm: str | None = None) -> list[dict]:
    """
    시간자료. tm 생략 시 현재시각.
    반환: [{stn_id, tm, temp, humidity, wind, precip_hour, precip_day}, ...]
    """
    params: dict[str, str] = {
        "stn": str(stn),
        "help": "0",
        "authKey": _auth_key(),
    }
    if tm:
        params["tm"] = tm
    url = f"{HOURLY_URL}?{urllib.parse.urlencode(params)}"
    text = _get(url)
    rows = []
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        parts = line.split()
        if len(parts) < 17:
            continue
        # TM STN WD WS ... TA(index11) TD HM(13) PV RN(15) RN_DAY(16)
        stn_id = _i(parts[1])
        if stn_id is None:
            continue
        ta = _f(parts[11])
        hm = _f(parts[13])
        ws = _f(parts[3])
        rn = _f(parts[15])
        rn_day = _f(parts[16])
        precip = rn_day if rn_day is not None else (rn if rn is not None else 0.0)
        if precip is None or precip < 0:
            precip = 0.0
        rows.append(
            {
                "tm": parts[0],
                "stn_id": stn_id,
                "temp": ta,
                "humidity": hm,
                "wind": ws if ws is not None else 0.0,
                "precip": precip,
                "precip_hour": rn if rn is not None and rn >= 0 else 0.0,
            }
        )
    return rows


def fetch_daily(tm: str, stn: int | str = 0) -> list[dict]:
    """
    일자료. tm=YYYYMMDD
    반환: [{stn_id, date, temp_avg, humidity_avg, wind_avg, precip}, ...]
    """
    params = {
        "tm": tm,
        "stn": str(stn),
        "help": "0",
        "authKey": _auth_key(),
    }
    url = f"{DAILY_URL}?{urllib.parse.urlencode(params)}"
    text = _get(url)
    rows = []
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if "," in line:
            parts = [p.strip() for p in line.split(",")]
        else:
            parts = re.split(r"\s+", line)
        parts = [p for p in parts if p != ""]
        if len(parts) < 20:
            continue
        stn_id = _i(parts[1])
        if stn_id is None:
            continue
        # 0 TM, 1 STN, 2 WS_AVG, 10 TA_AVG, 18 HM_AVG, 38 RN_DAY
        try:
            ws_avg = _f(parts[2])
            ta_avg = _f(parts[10])
            hm_avg = _f(parts[18])
            rn_day = _f(parts[38]) if len(parts) > 38 else None
        except IndexError:
            continue
        precip = rn_day if rn_day is not None and rn_day >= 0 else 0.0
        rows.append(
            {
                "date": parts[0],
                "stn_id": stn_id,
                "temp_avg": ta_avg,
                "humidity_avg": hm_avg,
                "wind_avg": ws_avg if ws_avg is not None else 0.0,
                "precip": precip,
            }
        )
    return rows


def hourly_to_model_weather(h: dict) -> dict:
    """시간자료 1건 → 모델 feature용 일 기상 근사."""
    t = h.get("temp")
    hm = h.get("humidity")
    w = h.get("wind") or 0.0
    p = h.get("precip") or 0.0
    if t is None:
        t = 20.0
    if hm is None:
        hm = 50.0
    return {
        "temp_avg": float(t),
        "precip": float(p),
        "wind_avg": float(w),
        "humidity_avg": min(100.0, float(hm) + 5.0),
    }


def fetch_now_weather_by_station() -> tuple[str, dict[int, dict], str]:
    """
    현재 시간자료 우선. 실패 시 오늘 일자료.
    반환: (YYYY-MM-DD, {stn_id: weather_dict}, source)
    """
    now = datetime.now(KST)
    date = now.strftime("%Y-%m-%d")
    hourly = fetch_hourly(stn=0)
    by_stn: dict[int, dict] = {}
    obs_tm = ""
    for h in hourly:
        if h.get("temp") is None and h.get("humidity") is None:
            continue
        by_stn[int(h["stn_id"])] = hourly_to_model_weather(h)
        obs_tm = str(h.get("tm") or obs_tm)
    if by_stn:
        if obs_tm and len(obs_tm) >= 8:
            date = f"{obs_tm[0:4]}-{obs_tm[4:6]}-{obs_tm[6:8]}"
        return date, by_stn, f"kma_hourly:{obs_tm or 'now'}"

    # fallback daily today
    tm = now.strftime("%Y%m%d")
    daily = fetch_daily(tm=tm, stn=0)
    for d in daily:
        if d.get("temp_avg") is None:
            continue
        by_stn[int(d["stn_id"])] = {
            "temp_avg": float(d["temp_avg"]),
            "precip": float(d["precip"] or 0),
            "wind_avg": float(d["wind_avg"] or 0),
            "humidity_avg": float(d["humidity_avg"] if d["humidity_avg"] is not None else 50),
        }
    if not by_stn:
        raise RuntimeError("기상청 ASOS에서 유효한 관측값을 받지 못했습니다.")
    return date, by_stn, f"kma_daily:{tm}"


if __name__ == "__main__":
    d, m, src = fetch_now_weather_by_station()
    print(src, "date", d, "stations", len(m))
    print("sample 108", m.get(108))
