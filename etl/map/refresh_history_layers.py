"""refined_wildfire 기준으로 admin-*.json / map-data.json 이력 수치·색만 갱신.

shapefile 재생성 없이 빠르게 돌릴 수 있습니다.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import json
import math
import re
from collections import defaultdict
from datetime import datetime

import pandas as pd

from map.build_admin_layers import (
    apply_prob,
    build_fire_indexes,
    load_fires,
    prob_from_count,
    roll_up_from_children,
    strip_admin,
)
from map.export_map_data import lerp_color
from paths import (
    ADMIN_EMD_JSON,
    ADMIN_SIDO_JSON,
    ADMIN_SIGUNGU_JSON,
    MAP_DATA_JSON,
    REFINED_WILDFIRE,
    ensure_dirs,
)


def _set_years_from_fires(fires: pd.DataFrame) -> float:
    if fires.empty:
        return 15.5
    dmin = pd.to_datetime(fires["date"], errors="coerce").min()
    dmax = pd.to_datetime(fires["date"], errors="coerce").max()
    if pd.isna(dmin) or pd.isna(dmax):
        return 15.5
    years = max((dmax - dmin).days / 365.25, 1.0)
    # build_admin_layers.prob_from_count 가 모듈 상수 YEARS 를 쓰므로 패치
    import map.build_admin_layers as bal

    bal.YEARS = years
    return years


def _patch_admin_layer(path: Path, by_code_count: dict[str, int]) -> int:
    if not path.exists():
        return 0
    data = json.loads(path.read_text(encoding="utf-8"))
    updated = 0
    for bucket in ("regions", "markers"):
        for item in data.get(bucket) or []:
            code = str(item.get("code") or "")
            if not code:
                continue
            # 시군구 코드 정확 매칭, 읍면동은 자체 카운트 키를 다시 계산하기 어려워
            # markers/regions 에 이미 있는 fire_count 를 by_code 로 덮어씀
            if code in by_code_count:
                c = int(by_code_count[code])
                item["fire_count"] = c
                apply_prob(item, prob_from_count(c))
                if "fill" in item:
                    item["fill"] = item["color"]
                updated += 1
    path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    return updated


def _recount_admin_from_indexes(fires: pd.DataFrame) -> dict:
    """admin JSON 의 name/province 로 건수를 다시 매칭."""
    by_prov, by_city, by_town_name, _by_vil = build_fire_indexes(fires)

    def patch_file(path: Path, level: str) -> int:
        if not path.exists():
            return 0
        data = json.loads(path.read_text(encoding="utf-8"))
        n = 0
        for bucket in ("regions", "markers"):
            for item in data.get(bucket) or []:
                name = str(item.get("name") or "")
                prov = str(item.get("province") or item.get("province_name") or "")
                # province 필드가 코드성 short 인 경우 대비
                short = prov
                for full, s in (
                    ("서울특별시", "서울"),
                    ("부산광역시", "부산"),
                    ("대구광역시", "대구"),
                    ("인천광역시", "인천"),
                    ("광주광역시", "광주"),
                    ("대전광역시", "대전"),
                    ("울산광역시", "울산"),
                    ("세종특별자치시", "세종"),
                    ("경기도", "경기"),
                    ("강원특별자치도", "강원"),
                    ("강원도", "강원"),
                    ("충청북도", "충북"),
                    ("충청남도", "충남"),
                    ("전북특별자치도", "전북"),
                    ("전라북도", "전북"),
                    ("전라남도", "전남"),
                    ("경상북도", "경북"),
                    ("경상남도", "경남"),
                    ("제주특별자치도", "제주"),
                ):
                    if prov == full or full in prov:
                        short = s
                        break
                key = strip_admin(name)
                if level == "sido":
                    # 시도명은 풀네임일 수 있음
                    c = 0
                    for sk, cnt in by_prov.items():
                        if sk in name or name.startswith(sk) or key == strip_admin(sk):
                            c += cnt
                    if "전남" in name and "광주" in name:
                        c = by_prov.get("전남", 0) + by_prov.get("광주", 0)
                    elif not c:
                        c = by_prov.get(short, 0) or by_prov.get(key, 0)
                elif level == "sigungu":
                    c = by_city.get(f"{short}|{key}", 0)
                    if not c:
                        # province short 재추정
                        for sk, cnt in by_city.items():
                            if sk.endswith(f"|{key}"):
                                c = cnt
                                break
                else:  # emd
                    c = by_town_name.get(f"{short}|{key}", 0)
                    if not c:
                        for sk, cnt in by_town_name.items():
                            if sk.endswith(f"|{key}"):
                                c = cnt
                                break
                item["fire_count"] = int(c)
                apply_prob(item, prob_from_count(int(c)))
                if "fill" in item:
                    item["fill"] = item["color"]
                n += 1
        # roll-up 색 일치
        if level == "emd":
            pass
        data["meta"] = data.get("meta") or {}
        data["meta"]["max_fire_count"] = int(
            max((r.get("fire_count") or 0 for r in data.get("regions") or []), default=0)
        )
        data["meta"]["synced_at"] = datetime.now().isoformat(timespec="seconds")
        path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        return n

    counts = {
        "sido": patch_file(ADMIN_SIDO_JSON, "sido"),
        "sigungu": patch_file(ADMIN_SIGUNGU_JSON, "sigungu"),
        "emd": patch_file(ADMIN_EMD_JSON, "emd"),
    }

    # 하위→상위 평균 (기존 build_admin_layers 와 동일)
    if ADMIN_EMD_JSON.exists() and ADMIN_SIGUNGU_JSON.exists():
        emd = json.loads(ADMIN_EMD_JSON.read_text(encoding="utf-8"))
        sig = json.loads(ADMIN_SIGUNGU_JSON.read_text(encoding="utf-8"))
        roll_up_from_children(sig.get("markers") or [], emd.get("markers") or [], lambda x: str(x.get("code", ""))[:5])
        roll_up_from_children(sig.get("regions") or [], emd.get("regions") or [], lambda x: str(x.get("code", ""))[:5])
        for r in sig.get("regions") or []:
            for m in sig.get("markers") or []:
                if r.get("code") == m.get("code"):
                    r["prob"] = m["prob"]
                    r["color"] = m["color"]
                    r["fill"] = m["color"]
                    r["r"] = m["r"]
                    r["fire_count"] = m.get("fire_count", r.get("fire_count"))
                    break
        ADMIN_SIGUNGU_JSON.write_text(json.dumps(sig, ensure_ascii=False), encoding="utf-8")

        if ADMIN_SIDO_JSON.exists():
            sido = json.loads(ADMIN_SIDO_JSON.read_text(encoding="utf-8"))
            roll_up_from_children(
                sido.get("markers") or [], sig.get("markers") or [], lambda x: x.get("province")
            )
            roll_up_from_children(
                sido.get("regions") or [], sig.get("regions") or [], lambda x: x.get("province")
            )
            for r in sido.get("regions") or []:
                for m in sido.get("markers") or []:
                    if r.get("code") == m.get("code"):
                        r["prob"] = m["prob"]
                        r["color"] = m["color"]
                        r["fill"] = m["color"]
                        r["r"] = m["r"]
                        r["fire_count"] = m.get("fire_count", r.get("fire_count"))
                        break
            ADMIN_SIDO_JSON.write_text(json.dumps(sido, ensure_ascii=False), encoding="utf-8")

    return counts


def _refresh_map_data(fires: pd.DataFrame) -> dict:
    if not MAP_DATA_JSON.exists():
        return {"updated": False, "reason": "map-data.json missing"}
    data = json.loads(MAP_DATA_JSON.read_text(encoding="utf-8"))
    by_city: dict[str, list] = defaultdict(list)
    for _, r in fires.iterrows():
        p = str(r.get("province") or "").strip()
        c = str(r.get("city") or "").strip()
        if not p or not c or c == "Unknown":
            continue
        by_city[f"{p}|{strip_admin(c)}"].append(r)

    regions = data.get("regions") or data.get("provinces") or []
    max_count = 1
    # first pass counts
    counts = []
    for reg in regions:
        prov = str(reg.get("province") or "").strip()
        name = strip_admin(str(reg.get("name") or ""))
        key = f"{prov}|{name}"
        # province may be full name in map-data
        rows = by_city.get(key, [])
        if not rows:
            for k, v in by_city.items():
                if k.endswith(f"|{name}"):
                    rows = v
                    break
        counts.append(len(rows))
    max_count = max(counts) if counts else 1

    history: dict[str, list] = {}
    for reg, fire_count in zip(regions, counts):
        intensity = fire_count / max_count if max_count else 0
        reg["fire_count"] = int(fire_count)
        reg["intensity"] = round(float(intensity), 4)
        reg["risk_score"] = round(float(intensity * 100), 1)
        reg["color"] = lerp_color(intensity) if fire_count > 0 else "#93C5FD"
        code = str(reg.get("code") or "")
        prov = str(reg.get("province") or "").strip()
        name = strip_admin(str(reg.get("name") or ""))
        rows = by_city.get(f"{prov}|{name}", [])
        if not rows:
            for k, v in by_city.items():
                if k.endswith(f"|{name}"):
                    rows = v
                    break
        hist = []
        for r in sorted(rows, key=lambda x: str(x.get("datetime") or ""), reverse=True)[:40]:
            hist.append(
                {
                    "datetime": str(r.get("datetime") or r.get("date") or ""),
                    "region": str(r.get("region_path") or ""),
                    "city": str(r.get("city") or ""),
                    "town": str(r.get("town") or ""),
                    "village": str(r.get("village") or ""),
                    "damage_area": float(r.get("damage_area") or 0),
                    "mountains": "",
                    "match_level": "openapi",
                }
            )
        if code:
            history[code] = hist

    if data.get("regions"):
        data["regions"] = regions
    if data.get("provinces") is regions or (
        data.get("provinces") and len(data["provinces"]) == len(regions)
    ):
        # some builds use provinces as main list
        pass
    # provinces: roll-up by province name if separate
    if data.get("provinces") and data["provinces"] is not regions:
        prov_counts: dict[str, int] = defaultdict(int)
        for reg, c in zip(regions, counts):
            prov_counts[str(reg.get("province") or "")] += c
        pmax = max(prov_counts.values()) if prov_counts else 1
        for p in data["provinces"]:
            key = str(p.get("province") or p.get("name") or "")
            fc = prov_counts.get(key, int(p.get("fire_count") or 0))
            intensity = fc / pmax if pmax else 0
            p["fire_count"] = int(fc)
            p["intensity"] = round(float(intensity), 4)
            p["risk_score"] = round(float(intensity * 100), 1)
            p["color"] = lerp_color(intensity) if fc > 0 else "#93C5FD"

    data["history"] = {**(data.get("history") or {}), **history}
    meta = data.get("meta") or {}
    meta["total_fires"] = int(len(fires))
    meta["synced_at"] = datetime.now().isoformat(timespec="seconds")
    meta["source"] = "wildfire-atlas+openapi"
    data["meta"] = meta

    MAP_DATA_JSON.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    return {
        "updated": True,
        "regions": len(regions),
        "total_fires": int(len(fires)),
        "history_keys": len(history),
    }


def refresh_history_layers() -> dict:
    ensure_dirs()
    if not REFINED_WILDFIRE.exists():
        raise FileNotFoundError(str(REFINED_WILDFIRE))
    fires = load_fires()
    years = _set_years_from_fires(fires)
    admin = _recount_admin_from_indexes(fires)
    map_info = _refresh_map_data(fires)
    return {
        "ok": True,
        "years_span": round(years, 2),
        "fire_rows": int(len(fires)),
        "admin": admin,
        "map_data": map_info,
        "refreshed_at": datetime.now().isoformat(timespec="seconds"),
    }


if __name__ == "__main__":
    print(json.dumps(refresh_history_layers(), ensure_ascii=False, indent=2))
