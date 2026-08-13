"""MariaDB forestfire_stats 기준으로 admin-*.json / map-data.json 이력 수치·색 갱신.

shapefile 재생성 없이 빠르게 돌릴 수 있습니다.
산불 원본은 MariaDB 우선, 실패 시에만 refined CSV 폴백.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
_ML = Path(__file__).resolve().parents[2] / "ml-service"
if str(_ML) not in sys.path:
    sys.path.insert(0, str(_ML))

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
from pipeline.admin_match import count_city_fires, count_town_fires
from pipeline.normalize_region_names import normalize_region_path_string
from paths import (
    ADMIN_EMD_JSON,
    ADMIN_SIDO_JSON,
    ADMIN_SIGUNGU_JSON,
    MAP_DATA_JSON,
    ensure_dirs,
    sync_backend_data,
)


def _load_fire_source(fires_df: pd.DataFrame | None = None) -> pd.DataFrame:
    """MariaDB forestfire_stats 우선, 없으면 refined CSV."""
    if fires_df is not None:
        return fires_df.copy()
    from pipeline.load_wildfire_history import load_wildfire_history_raw

    return load_wildfire_history_raw()


def _recount_admin_from_indexes(fires: pd.DataFrame) -> dict:
    """admin JSON 의 name/province 로 건수를 다시 매칭."""
    by_prov, by_city, by_town_name, _by_vil = build_fire_indexes(fires)
    sig_names: dict[str, str] = {}
    if ADMIN_SIGUNGU_JSON.exists():
        sig_data = json.loads(ADMIN_SIGUNGU_JSON.read_text(encoding="utf-8"))
        sig_names = {
            str(item.get("code") or ""): str(item.get("name") or "")
            for item in sig_data.get("regions") or []
        }

    def patch_file(path: Path, level: str) -> int:
        if not path.exists():
            return 0
        data = json.loads(path.read_text(encoding="utf-8"))
        n = 0
        for item in data.get("regions") or []:
            name = str(item.get("name") or "")
            prov = str(item.get("province") or item.get("province_name") or "")
            code = str(item.get("code") or "")
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
                ("전남광주통합특별시", "전남"),
                ("경상북도", "경북"),
                ("경상남도", "경남"),
                ("제주특별자치도", "제주"),
            ):
                if prov == full or name == full or full in prov or full in name:
                    short = s
                    break
            if level == "sido":
                # 시도: DB 공식명·약칭·통합 폴리곤 모두 반영
                c = 0
                for sk, cnt in by_prov.items():
                    if sk in name or name.startswith(sk) or strip_admin(name) == strip_admin(sk):
                        c += cnt
                # shapefile 통합 영역(전남+광주) — DB의 전남·광주 건수 합산
                if ("전남" in name and "광주" in name) or name == "전남광주통합특별시":
                    c = by_prov.get("전남", 0) + by_prov.get("광주", 0)
                elif not c:
                    c = by_prov.get(short, 0) or by_prov.get(strip_admin(name), 0)
            elif level == "sigungu":
                c = count_city_fires(by_city, short, name)
            else:  # emd — 상위 시군구 + 읍면동 접미사로 한정 (장흥면 ≠ 장흥군)
                parent = sig_names.get(code[:5], "") if len(code) >= 5 else ""
                c = count_town_fires(by_town_name, short, parent, name)
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


def _event_payload(r) -> dict:
    return {
        "datetime": str(r.get("datetime") or r.get("date") or ""),
        "region": _clean_region_path(r.get("region_path") or ""),
        "city": str(r.get("city") or ""),
        "town": str(r.get("town") or ""),
        "village": str(r.get("village") or ""),
        "damage_area": float(r.get("damage_area") or 0),
        "mountains": "",
        "match_level": "db",
    }


def _refresh_map_data(
    fires: pd.DataFrame, *, total_fires: int | None = None
) -> dict:
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
    used_keys: set[str] = set()
    counts = []
    for reg in regions:
        prov = str(reg.get("province") or "").strip()
        name = strip_admin(str(reg.get("name") or ""))
        key = f"{prov}|{name}"
        used_keys.add(key)
        rows = by_city.get(key, [])
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
        hist = [
            _event_payload(r)
            for r in sorted(rows, key=lambda x: str(x.get("datetime") or ""), reverse=True)
        ]
        if code:
            history[code] = hist

    # 시군구 폴리곤에 못 붙인 건(용인시→구 미지정 등)도 시도 선택 시 목록에 포함
    leftover = []
    for key, rows in by_city.items():
        if key in used_keys:
            continue
        leftover.extend(rows)
    if leftover:
        history["_unmatched"] = [
            _event_payload(r)
            for r in sorted(
                leftover, key=lambda x: str(x.get("datetime") or ""), reverse=True
            )
        ]

    if data.get("regions"):
        data["regions"] = regions
    data["provinces"] = []

    data["history"] = history
    meta = data.get("meta") or {}
    meta["total_fires"] = int(total_fires if total_fires is not None else len(fires))
    meta["synced_at"] = datetime.now().isoformat(timespec="seconds")
    meta["source"] = "mariadb:forestfire_stats"
    data["meta"] = meta

    MAP_DATA_JSON.write_text(
        json.dumps(data, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    return {
        "updated": True,
        "regions": len(regions),
        "total_fires": int(meta["total_fires"]),
        "history_keys": len(history),
        "unmatched_city_events": len(leftover),
    }


def refresh_history_layers(fires_df: pd.DataFrame | None = None) -> dict:
    ensure_dirs()
    raw = _load_fire_source(fires_df)
    total_fires = int(len(raw))
    fires = load_fires(raw)
    unmatched = total_fires - int(len(fires))
    admin = _recount_admin_from_indexes(fires)
    map_info = _refresh_map_data(fires, total_fires=total_fires)
    sync_backend_data()
    return {
        "ok": True,
        "fire_rows": int(len(fires)),
        "fire_rows_raw": total_fires,
        "unmatched_province": int(unmatched),
        "admin": admin,
        "map_data": map_info,
        "refreshed_at": datetime.now().isoformat(timespec="seconds"),
    }


if __name__ == "__main__":
    print(json.dumps(refresh_history_layers(), ensure_ascii=False, indent=2))
