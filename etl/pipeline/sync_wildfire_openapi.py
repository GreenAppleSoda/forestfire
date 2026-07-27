"""산불 OpenAPI → refined 이력 증분 → admin/map-data 이력 갱신.

사용:
  python etl/pipeline/sync_wildfire_openapi.py
  python etl/pipeline/sync_wildfire_openapi.py --days 180
  python etl/pipeline/sync_wildfire_openapi.py --start 20260101 --end 20260727

환경변수: FOREST_FIRE_SERVICE_KEY (data.go.kr 인증키)
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pandas as pd

from map.refresh_history_layers import refresh_history_layers
from paths import (
    REFINED_WILDFIRE,
    WILDFIRE_OPENAPI_RAW,
    WILDFIRE_OPENAPI_STATE,
    ensure_dirs,
)
from pipeline.forest_fire_openapi import fetch_range, service_key


def _pad2(v: object) -> str:
    s = str(v or "").strip()
    if not s:
        return "01"
    try:
        return f"{int(s):02d}"
    except ValueError:
        return s.zfill(2)[-2:]


def openapi_item_to_refined(item: dict) -> dict | None:
    y = str(item.get("startyear") or "").strip()
    m = _pad2(item.get("startmonth"))
    d = _pad2(item.get("startday"))
    if not y:
        return None
    t = str(item.get("starttime") or "00:00:00").strip()
    if re_full := __import__("re").match(r"^(\d{1,2}:\d{2})(:\d{2})?$", t):
        t = re_full.group(1) if not re_full.group(2) else t
    else:
        t = "00:00"
    try:
        date = pd.Timestamp(f"{y}-{m}-{d}")
        datetime_v = pd.to_datetime(f"{y}-{m}-{d} {t}", errors="coerce")
    except Exception:
        return None
    if pd.isna(date) or pd.isna(datetime_v):
        return None

    province = str(item.get("locsi") or "Unknown").strip() or "Unknown"
    city = str(item.get("locgungu") or "Unknown").strip() or "Unknown"
    town = str(item.get("locmenu") or "Unknown").strip() or "Unknown"
    village = str(item.get("locdong") or "Unknown").strip() or "Unknown"
    cause = str(item.get("firecause") or "Unknown").strip() or "Unknown"
    try:
        damage = float(item.get("damagearea") or 0)
    except (TypeError, ValueError):
        damage = 0.0

    return {
        "date": date.strftime("%Y-%m-%d"),
        "datetime": datetime_v.strftime("%Y-%m-%d %H:%M:%S"),
        "hour": int(datetime_v.hour) if pd.notna(datetime_v) else 0,
        "time": t,
        "province": province,
        "city": city,
        "town": town,
        "village": village,
        "damage_area": damage,
        "cause": cause,
        "region_path": f"{province} > {city} > {town} > {village}",
        "is_fire": 1,
    }


def event_key(row: dict | pd.Series) -> str:
    return "|".join(
        [
            str(row.get("datetime") or ""),
            str(row.get("province") or ""),
            str(row.get("city") or ""),
            str(row.get("town") or ""),
            str(row.get("village") or ""),
            str(row.get("damage_area") or ""),
            str(row.get("cause") or ""),
        ]
    )


def _default_start(days: int) -> str:
    if REFINED_WILDFIRE.exists():
        df = pd.read_csv(REFINED_WILDFIRE, encoding="utf-8")
        if "date" in df.columns and len(df):
            last = pd.to_datetime(df["date"], errors="coerce").max()
            if pd.notna(last):
                # 겹침 여유 14일
                start = (last - pd.Timedelta(days=14)).strftime("%Y%m%d")
                return start
    return (datetime.now() - timedelta(days=days)).strftime("%Y%m%d")


def run_sync(
    *,
    start: str | None = None,
    end: str | None = None,
    days: int = 120,
    skip_map_refresh: bool = False,
) -> dict:
    ensure_dirs()
    # 키 검사 (없으면 여기서 실패)
    service_key()

    start_s = start or _default_start(days)
    end_s = end or datetime.now().strftime("%Y%m%d")

    items = fetch_range(start=start_s, end=end_s)
    WILDFIRE_OPENAPI_RAW.write_text(
        json.dumps(
            {
                "fetched_at": datetime.now().isoformat(timespec="seconds"),
                "start": start_s,
                "end": end_s,
                "count": len(items),
                "items": items,
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    new_rows = []
    for it in items:
        row = openapi_item_to_refined(it)
        if row:
            new_rows.append(row)

    if REFINED_WILDFIRE.exists():
        existing = pd.read_csv(REFINED_WILDFIRE, encoding="utf-8")
    else:
        existing = pd.DataFrame(
            columns=[
                "date",
                "datetime",
                "hour",
                "time",
                "province",
                "city",
                "town",
                "village",
                "damage_area",
                "cause",
                "region_path",
                "is_fire",
            ]
        )

    existing_keys = set(event_key(r) for _, r in existing.iterrows()) if len(existing) else set()
    added = []
    for row in new_rows:
        k = event_key(row)
        if k not in existing_keys:
            existing_keys.add(k)
            added.append(row)

    if added:
        merged = pd.concat([existing, pd.DataFrame(added)], ignore_index=True)
        merged["datetime"] = pd.to_datetime(merged["datetime"], errors="coerce")
        merged = merged.sort_values("datetime", ascending=False).reset_index(drop=True)
        # date 컬럼 정규화
        merged["date"] = pd.to_datetime(merged["date"], errors="coerce").dt.strftime("%Y-%m-%d")
        merged.to_csv(REFINED_WILDFIRE, index=False, encoding="utf-8")
    else:
        merged = existing

    refresh_info = None
    if not skip_map_refresh:
        refresh_info = refresh_history_layers()

    state = {
        "last_sync_at": datetime.now().isoformat(timespec="seconds"),
        "query_start": start_s,
        "query_end": end_s,
        "fetched": len(items),
        "parsed": len(new_rows),
        "added": len(added),
        "refined_total": int(len(merged)),
        "map_refresh": refresh_info,
    }
    WILDFIRE_OPENAPI_STATE.write_text(
        json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return {"ok": True, **state}


def main() -> None:
    parser = argparse.ArgumentParser(description="산불 OpenAPI 이력 증분 동기화")
    parser.add_argument("--start", default=None, help="YYYYMMDD")
    parser.add_argument("--end", default=None, help="YYYYMMDD")
    parser.add_argument("--days", type=int, default=120, help="start 미지정 시 최근 N일")
    parser.add_argument("--skip-map-refresh", action="store_true")
    args = parser.parse_args()
    result = run_sync(
        start=args.start,
        end=args.end,
        days=args.days,
        skip_map_refresh=args.skip_map_refresh,
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
