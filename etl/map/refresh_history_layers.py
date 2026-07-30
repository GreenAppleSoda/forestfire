"""refined_wildfire 기준으로 admin-*.json / map-data.json 이력 수치·색만 갱신.

shapefile 재생성 없이 빠르게 돌릴 수 있습니다.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import json
from collections import defaultdict
from datetime import datetime

import pandas as pd

from map.build_admin_layers import (
    build_fire_indexes,
    load_fires,
    recolor_regions_by_fire_count,
    strip_admin,
)
from map.export_map_data import lerp_color
from pipeline.normalize_region_names import normalize_region_path_string
from paths import (
    ADMIN_EMD_JSON,
    ADMIN_SIDO_JSON,
    ADMIN_SIGUNGU_JSON,
    MAP_DATA_JSON,
    REFINED_WILDFIRE,
    ensure_dirs,
)


def _patch_admin_layer(path: Path, by_code_count: dict[str, int]) -> int:
    if not path.exists():
        return 0
    data = json.loads(path.read_text(encoding="utf-8"))
    updated = 0
    for item in data.get("regions") or []:
        code = str(item.get("code") or "")
        if not code:
            continue
        if code in by_code_count:
            item["fire_count"] = int(by_code_count[code])
            updated += 1
    mx = recolor_regions_by_fire_count(data.get("regions") or [])
    data["meta"] = data.get("meta") or {}
    data["meta"]["max_fire_count"] = mx
    data["meta"]["prob_note"] = "과거 산불 발생 건수 상대 빈도(같은 행정 레벨 내 비교)"
    data["meta"]["synced_at"] = datetime.now().isoformat(timespec="seconds")
    path.write_text(
        json.dumps(data, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    return updated


def _recount_admin_from_indexes(fires: pd.DataFrame) -> dict:
    """admin JSON 의 name/province 로 건수를 다시 매칭."""
    by_prov, by_city, by_town_name, _by_vil = build_fire_indexes(fires)

    def patch_file(path: Path, level: str) -> int:
        if not path.exists():
            return 0
        data = json.loads(path.read_text(encoding="utf-8"))
        n = 0
        for item in data.get("regions") or []:
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
            n += 1
        mx = recolor_regions_by_fire_count(data.get("regions") or [])
        data["meta"] = data.get("meta") or {}
        data["meta"]["max_fire_count"] = mx
        data["meta"]["prob_note"] = "과거 산불 발생 건수 상대 빈도(같은 행정 레벨 내 비교)"
        data["meta"]["synced_at"] = datetime.now().isoformat(timespec="seconds")
        path.write_text(
            json.dumps(data, ensure_ascii=False, separators=(",", ":")),
            encoding="utf-8",
        )
        return n

    return {
        "sido": patch_file(ADMIN_SIDO_JSON, "sido"),
        "sigungu": patch_file(ADMIN_SIGUNGU_JSON, "sigungu"),
        "emd": patch_file(ADMIN_EMD_JSON, "emd"),
    }


def _clean_region_path(path: object) -> str:
    """표시용: Unknown 제거 + 법정동 공식명."""
    return normalize_region_path_string(str(path or ""))


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
                    "region": _clean_region_path(r.get("region_path") or ""),
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
    # provinces 중복 제거 유지
    data["provinces"] = []

    data["history"] = {**(data.get("history") or {}), **history}
    meta = data.get("meta") or {}
    meta["total_fires"] = int(len(fires))
    meta["synced_at"] = datetime.now().isoformat(timespec="seconds")
    meta["source"] = "wildfire-atlas+openapi"
    data["meta"] = meta

    MAP_DATA_JSON.write_text(
        json.dumps(data, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
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
    admin = _recount_admin_from_indexes(fires)
    map_info = _refresh_map_data(fires)
    return {
        "ok": True,
        "fire_rows": int(len(fires)),
        "admin": admin,
        "map_data": map_info,
        "refreshed_at": datetime.now().isoformat(timespec="seconds"),
    }


if __name__ == "__main__":
    print(json.dumps(refresh_history_layers(), ensure_ascii=False, indent=2))
