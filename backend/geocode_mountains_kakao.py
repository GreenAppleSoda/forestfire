"""
산 주소 → 카카오 로컬(지오코딩) → 위경도 + SVG 좌표

- 입력: db/processed/mountain_data.csv
- 캐시: db/processed/mountain_geocode_cache.json  (재실행 시 스킵)
- 출력:
    db/processed/mountain_coords.csv
    db/processed/mountain_coords.json

사용:
  python backend/geocode_mountains_kakao.py
  python backend/geocode_mountains_kakao.py --limit 20   # 테스트
  python backend/geocode_mountains_kakao.py --force      # 캐시 무시 재조회

환경변수: KAKAO_REST_API_KEY (frontend/.env.local 에서도 읽음)
"""

from __future__ import annotations

import argparse
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

import pandas as pd
from pyproj import Transformer

from paths import (
    DATA_PROCESSED,
    FRONTEND_ENV_LOCAL,
    MOUNTAIN_DATA,
    ROOT,
    ensure_dirs,
)

CACHE_PATH = DATA_PROCESSED / "mountain_geocode_cache.json"
OUT_CSV = DATA_PROCESSED / "mountain_coords.csv"
OUT_JSON = DATA_PROCESSED / "mountain_coords.json"

ADDRESS_URL = "https://dapi.kakao.com/v2/local/search/address.json"
KEYWORD_URL = "https://dapi.kakao.com/v2/local/search/keyword.json"

# build_admin_layers.py 와 동일 (Korea 2000 / Unified CS ≈ EPSG:5179)
XMIN, YMIN = 740000.0, 1450000.0
XMAX, YMAX = 1395000.0, 2075000.0
WIDTH, HEIGHT = 800, 900
PAD = 24

_TRANSFORMER = Transformer.from_crs("EPSG:4326", "EPSG:5179", always_xy=True)


def _load_api_key() -> str:
    key = (os.environ.get("KAKAO_REST_API_KEY") or "").strip()
    if key:
        return key
    env_path = FRONTEND_ENV_LOCAL
    if env_path.exists():
        for line in env_path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line.startswith("KAKAO_REST_API_KEY="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise RuntimeError(
        "KAKAO_REST_API_KEY 없음. frontend/.env.local 에 KAKAO_REST_API_KEY=... 를 넣어 주세요."
    )


def to_svg(tm_x: float, tm_y: float) -> tuple[float, float]:
    sx = PAD + (tm_x - XMIN) / (XMAX - XMIN) * (WIDTH - 2 * PAD)
    sy = PAD + (YMAX - tm_y) / (YMAX - YMIN) * (HEIGHT - 2 * PAD)
    return round(sx, 2), round(sy, 2)


def wgs84_to_svg(lon: float, lat: float) -> tuple[float, float]:
    tm_x, tm_y = _TRANSFORMER.transform(lon, lat)
    return to_svg(tm_x, tm_y)


def load_cache() -> dict:
    if CACHE_PATH.exists():
        return json.loads(CACHE_PATH.read_text(encoding="utf-8"))
    return {}


def save_cache(cache: dict) -> None:
    CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
    CACHE_PATH.write_text(
        json.dumps(cache, ensure_ascii=False, indent=None),
        encoding="utf-8",
    )


def _http_get(url: str, key: str, retries: int = 4) -> dict:
    req = urllib.request.Request(
        url,
        headers={
            "Authorization": f"KakaoAK {key}",
            "User-Agent": "wildfire-atlas/1.0",
        },
    )
    delay = 0.5
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=20) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", errors="replace")
            if e.code in (429, 500, 502, 503) and attempt < retries - 1:
                time.sleep(delay)
                delay = min(delay * 2, 8.0)
                continue
            raise RuntimeError(f"HTTP {e.code}: {body[:200]}") from e
        except urllib.error.URLError as e:
            if attempt < retries - 1:
                time.sleep(delay)
                delay = min(delay * 2, 8.0)
                continue
            raise RuntimeError(str(e)) from e
    return {}


def geocode_address(address: str, key: str) -> dict | None:
    if not address or not address.strip():
        return None
    qs = urllib.parse.urlencode({"query": address.strip()})
    data = _http_get(f"{ADDRESS_URL}?{qs}", key)
    docs = data.get("documents") or []
    if not docs:
        return None
    d = docs[0]
    # road_address 우선, 없으면 address
    road = d.get("road_address") or {}
    addr = d.get("address") or {}
    lon = road.get("x") or addr.get("x") or d.get("x")
    lat = road.get("y") or addr.get("y") or d.get("y")
    if lon is None or lat is None:
        return None
    return {
        "lon": float(lon),
        "lat": float(lat),
        "method": "address",
        "matched": (road.get("address_name") or addr.get("address_name") or d.get("address_name") or ""),
    }


def geocode_keyword(query: str, key: str) -> dict | None:
    if not query or not query.strip():
        return None
    qs = urllib.parse.urlencode({"query": query.strip(), "size": 5})
    data = _http_get(f"{KEYWORD_URL}?{qs}", key)
    docs = data.get("documents") or []
    if not docs:
        return None
    # 산/봉 우선
    pick = None
    for d in docs:
        cat = str(d.get("category_name") or "")
        name = str(d.get("place_name") or "")
        if "산" in cat or "산" in name or "봉" in name:
            pick = d
            break
    if pick is None:
        pick = docs[0]
    lon, lat = pick.get("x"), pick.get("y")
    if lon is None or lat is None:
        return None
    return {
        "lon": float(lon),
        "lat": float(lat),
        "method": "keyword",
        "matched": str(pick.get("place_name") or pick.get("address_name") or ""),
    }


def geocode_mountain(name: str, address: str, key: str) -> dict:
    """성공/실패 공통 스키마."""
    hit = geocode_address(address, key) if address else None
    if not hit and name:
        # 산이름 + 주소 앞부분
        parts = [p for p in (address or "").replace(",", " ").split() if p]
        hint = " ".join(parts[:3])
        q = f"{name} {hint}".strip() if hint else name
        hit = geocode_keyword(q, key)
    if not hit and name:
        hit = geocode_keyword(name, key)
    if not hit:
        return {
            "ok": False,
            "lon": None,
            "lat": None,
            "svg_x": None,
            "svg_y": None,
            "method": "fail",
            "matched": "",
            "query_address": address,
            "query_name": name,
        }
    sx, sy = wgs84_to_svg(hit["lon"], hit["lat"])
    return {
        "ok": True,
        "lon": round(hit["lon"], 6),
        "lat": round(hit["lat"], 6),
        "svg_x": sx,
        "svg_y": sy,
        "method": hit["method"],
        "matched": hit.get("matched") or "",
        "query_address": address,
        "query_name": name,
    }


def main() -> None:
    ensure_dirs()
    parser = argparse.ArgumentParser(description="산 주소 카카오 지오코딩")
    parser.add_argument("--limit", type=int, default=0, help="처리할 최대 건수 (0=전체)")
    parser.add_argument("--force", action="store_true", help="캐시된 성공 건도 재조회")
    parser.add_argument(
        "--sleep",
        type=float,
        default=0.08,
        help="요청 간 대기(초). 기본 0.08 ≈ 초당 12회",
    )
    parser.add_argument(
        "--save-every",
        type=int,
        default=50,
        help="캐시 중간 저장 주기",
    )
    args = parser.parse_args()

    key = _load_api_key()
    mtn = pd.read_csv(MOUNTAIN_DATA, encoding="utf-8-sig")
    mtn["mntn_id"] = mtn["mntn_id"].astype(str).str.replace(r"\.0$", "", regex=True)
    mtn = mtn.drop_duplicates("mntn_id", keep="first")

    cache = load_cache()
    rows = list(mtn.itertuples(index=False))
    if args.limit and args.limit > 0:
        rows = rows[: args.limit]

    n_ok = n_fail = n_skip = n_new = 0
    t0 = time.time()

    for i, r in enumerate(rows, 1):
        mid = str(r.mntn_id)
        name = str(getattr(r, "mntn_nm", "") or "")
        address = str(getattr(r, "mntn_add", "") or "")
        if address.lower() in {"nan", "none"}:
            address = ""

        prev = cache.get(mid)
        if (
            not args.force
            and prev
            and prev.get("ok")
            and prev.get("lon") is not None
            and prev.get("svg_x") is not None
        ):
            n_skip += 1
            n_ok += 1
            continue

        try:
            result = geocode_mountain(name, address, key)
        except Exception as e:
            result = {
                "ok": False,
                "lon": None,
                "lat": None,
                "svg_x": None,
                "svg_y": None,
                "method": "error",
                "matched": "",
                "query_address": address,
                "query_name": name,
                "error": str(e)[:200],
            }

        cache[mid] = {
            "mntn_id": mid,
            "mntn_nm": name,
            **result,
        }
        n_new += 1
        if result.get("ok"):
            n_ok += 1
        else:
            n_fail += 1

        if i % args.save_every == 0:
            save_cache(cache)
            elapsed = time.time() - t0
            print(
                f"[{i}/{len(rows)}] new={n_new} ok={n_ok} fail={n_fail} "
                f"skip={n_skip} {elapsed:.0f}s"
            )

        time.sleep(max(0.0, args.sleep))

    save_cache(cache)

    # 전체 mountain_data 기준으로 출력 (캐시 병합)
    out_rows = []
    for r in mtn.itertuples(index=False):
        mid = str(r.mntn_id)
        name = str(getattr(r, "mntn_nm", "") or "")
        address = str(getattr(r, "mntn_add", "") or "")
        c = cache.get(mid) or {}
        out_rows.append(
            {
                "mntn_id": mid,
                "mntn_nm": name,
                "mntn_add": address if address.lower() not in {"nan", "none"} else "",
                "lon": c.get("lon"),
                "lat": c.get("lat"),
                "svg_x": c.get("svg_x"),
                "svg_y": c.get("svg_y"),
                "ok": bool(c.get("ok")),
                "method": c.get("method") or "",
                "matched": c.get("matched") or "",
            }
        )

    out_df = pd.DataFrame(out_rows)
    out_df.to_csv(OUT_CSV, index=False, encoding="utf-8-sig")
    payload = {
        "meta": {
            "source": "kakao_local_api",
            "n_total": int(len(out_df)),
            "n_ok": int(out_df["ok"].sum()),
            "n_fail": int((~out_df["ok"]).sum()),
            "crs_wgs84": "EPSG:4326",
            "crs_tm": "EPSG:5179",
            "svg_viewBox": [WIDTH, HEIGHT],
        },
        "mountains": {
            str(r["mntn_id"]): {
                "id": str(r["mntn_id"]),
                "name": r["mntn_nm"],
                "address": r["mntn_add"],
                "lon": r["lon"],
                "lat": r["lat"],
                "svg_x": r["svg_x"],
                "svg_y": r["svg_y"],
                "ok": bool(r["ok"]),
                "method": r["method"],
                "matched": r["matched"],
            }
            for _, r in out_df.iterrows()
        },
    }
    OUT_JSON.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")

    print(
        f"완료: total={len(out_df)} ok={payload['meta']['n_ok']} "
        f"fail={payload['meta']['n_fail']} new_calls~={n_new} skip={n_skip}"
    )
    print(f"캐시: {CACHE_PATH}")
    print(f"CSV:  {OUT_CSV}")
    print(f"JSON: {OUT_JSON}")


if __name__ == "__main__":
    main()
