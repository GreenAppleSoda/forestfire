"""
산불 발생 건(시점·장소) ↔ 산 이름·소재지 이벤트 매칭.

산불 CSV에는 산 이름이 없으므로, 같은 읍면(우선) / 시군구(보조)에
등록된 산을 '해당 시점·장소의 산불 후보 산'으로 연결합니다.
(정확한 발화 봉우리는 좌표가 없어 확정할 수 없음)
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import json

import pandas as pd

from paths import (
    MOUNTAIN_LOCATION,
    REFINED_WILDFIRE,
    WILDFIRE_BY_MOUNTAIN,
    WILDFIRE_MOUNTAIN_EVENTS,
    WILDFIRE_MOUNTAIN_EVENTS_SUMMARY,
    WILDFIRE_WITH_MOUNTAINS,
    ensure_dirs,
)

FIRE_CSV = REFINED_WILDFIRE
MOUNTAIN_LOC = MOUNTAIN_LOCATION

OUT_EVENTS = WILDFIRE_MOUNTAIN_EVENTS
OUT_FIRE_VIEW = WILDFIRE_WITH_MOUNTAINS
OUT_MOUNTAIN_SUMMARY = WILDFIRE_BY_MOUNTAIN
OUT_JSON = WILDFIRE_MOUNTAIN_EVENTS_SUMMARY


def load_fire() -> pd.DataFrame:
    df = pd.read_csv(FIRE_CSV)
    df["date"] = pd.to_datetime(df["date"])
    df["datetime"] = pd.to_datetime(df.get("datetime"), errors="coerce")
    for c in ["province", "city", "town", "village", "time", "cause"]:
        if c in df.columns:
            df[c] = df[c].fillna("Unknown").astype(str).str.strip()
    df["hour"] = pd.to_numeric(df.get("hour"), errors="coerce")
    df["fire_id"] = range(1, len(df) + 1)
    df["city_key"] = df["province"] + " " + df["city"]
    df["town_key"] = df["city_key"] + " " + df["town"]
    return df


META_COLS = [
    "mntn_id",
    "mntn_nm",
    "mntn_hght",
    "mntn_add",
    "mntn_details",
    "mntn_notable",
    "mntn_summary",
    "mntn_admin",
    "mntn_admin_tel",
    "province",
    "city",
    "town",
]


def load_mountains() -> pd.DataFrame:
    m = pd.read_csv(MOUNTAIN_LOC)
    m["mntn_hght"] = pd.to_numeric(m["mntn_hght"], errors="coerce")
    for c in [
        "province",
        "city",
        "town",
        "city_key",
        "town_key",
        "mntn_nm",
        "mntn_add",
        "mntn_id",
        "mntn_details",
        "mntn_notable",
        "mntn_summary",
        "mntn_admin",
        "mntn_admin_tel",
    ]:
        if c in m.columns:
            m[c] = m[c].fillna("").astype(str).str.strip()
        elif c.startswith("mntn_"):
            m[c] = ""
    m.loc[m["province"] == "", "province"] = "Unknown"
    m.loc[m["city"] == "", "city"] = "Unknown"
    m.loc[m["town"] == "", "town"] = "Unknown"
    m = m[m["province"] != "Unknown"].copy()
    return m


def mountain_lookup(m: pd.DataFrame) -> tuple[dict, dict]:
    """town_key / city_key → 산 목록 (id, name, height, address, details)."""

    def pack(g: pd.DataFrame) -> list[dict]:
        g = g.drop_duplicates(subset=["mntn_id"])
        rows = []
        for _, r in g.iterrows():
            rows.append(
                {
                    "mntn_id": r["mntn_id"],
                    "mntn_nm": r["mntn_nm"],
                    "mntn_hght": None if pd.isna(r["mntn_hght"]) else float(r["mntn_hght"]),
                    "mntn_add": r["mntn_add"],
                    "mntn_details": r.get("mntn_details", ""),
                    "mntn_notable": r.get("mntn_notable", ""),
                    "mntn_summary": r.get("mntn_summary", ""),
                    "mntn_admin": r.get("mntn_admin", ""),
                    "mntn_admin_tel": r.get("mntn_admin_tel", ""),
                    "province": r["province"],
                    "city": r["city"],
                    "town": r["town"],
                }
            )
        return rows

    by_town: dict[str, list[dict]] = {}
    for key, g in m[m["town"] != "Unknown"].groupby("town_key"):
        by_town[key] = pack(g[META_COLS])

    by_city: dict[str, list[dict]] = {}
    for key, g in m.groupby("city_key"):
        by_city[key] = pack(g[META_COLS])

    return by_town, by_city


def match_events(fire: pd.DataFrame, by_town: dict, by_city: dict) -> pd.DataFrame:
    rows = []
    for _, f in fire.iterrows():
        town_mts = by_town.get(f["town_key"], []) if f["town"] != "Unknown" else []
        city_mts = by_city.get(f["city_key"], [])

        if town_mts:
            matched = town_mts
            match_level = "town"
        elif city_mts:
            matched = city_mts
            match_level = "city"
        else:
            matched = []
            match_level = "none"

        base = {
            "fire_id": f["fire_id"],
            "datetime": f["datetime"] if pd.notna(f["datetime"]) else f["date"],
            "date": f["date"].date() if hasattr(f["date"], "date") else f["date"],
            "hour": int(f["hour"]) if pd.notna(f["hour"]) else None,
            "time": f.get("time", ""),
            "fire_province": f["province"],
            "fire_city": f["city"],
            "fire_town": f["town"],
            "fire_village": f["village"],
            "fire_region": f.get("region_path", f["town_key"]),
            "damage_area": f["damage_area"],
            "cause": f.get("cause", ""),
            "match_level": match_level,
            "matched_mountain_count": len(matched),
        }

        if not matched:
            rows.append(
                {
                    **base,
                    "mntn_id": "",
                    "mntn_nm": "",
                    "mntn_hght": None,
                    "mntn_add": "",
                    "mntn_details": "",
                    "mntn_notable": "",
                    "mntn_summary": "",
                    "mntn_admin": "",
                    "mntn_admin_tel": "",
                    "mntn_province": "",
                    "mntn_city": "",
                    "mntn_town": "",
                }
            )
            continue

        for mt in matched:
            rows.append(
                {
                    **base,
                    "mntn_id": mt["mntn_id"],
                    "mntn_nm": mt["mntn_nm"],
                    "mntn_hght": mt["mntn_hght"],
                    "mntn_add": mt["mntn_add"],
                    "mntn_details": mt.get("mntn_details", ""),
                    "mntn_notable": mt.get("mntn_notable", ""),
                    "mntn_summary": mt.get("mntn_summary", ""),
                    "mntn_admin": mt.get("mntn_admin", ""),
                    "mntn_admin_tel": mt.get("mntn_admin_tel", ""),
                    "mntn_province": mt["province"],
                    "mntn_city": mt["city"],
                    "mntn_town": mt["town"],
                }
            )
    return pd.DataFrame(rows)


def summarize_by_mountain(events: pd.DataFrame) -> pd.DataFrame:
    hit = events[(events["match_level"] != "none") & (events["mntn_nm"] != "")].copy()
    if hit.empty:
        return pd.DataFrame()

    g = (
        hit.groupby(["mntn_id", "mntn_nm", "mntn_add"], as_index=False)
        .agg(
            fire_event_count=("fire_id", "nunique"),
            first_fire=("datetime", "min"),
            last_fire=("datetime", "max"),
            total_damage_ha=("damage_area", "sum"),
            max_damage_ha=("damage_area", "max"),
            median_damage_ha=("damage_area", "median"),
            peak_hour=("hour", lambda s: int(s.dropna().mode().iloc[0]) if s.dropna().size else -1),
            match_town_share=("match_level", lambda s: float((s == "town").mean() * 100)),
            mntn_hght=("mntn_hght", "first"),
            sample_regions=("fire_region", lambda s: " | ".join(sorted(set(s.astype(str)))[:5])),
        )
        .sort_values(["fire_event_count", "total_damage_ha"], ascending=False)
    )
    return g


def main() -> None:
    ensure_dirs()
    fire = load_fire()
    mtn = load_mountains()
    by_town, by_city = mountain_lookup(mtn)

    events = match_events(fire, by_town, by_city)
    events = events.sort_values(["datetime", "fire_id", "mntn_nm"], ascending=[False, True, True])
    events.to_csv(OUT_EVENTS, index=False, encoding="utf-8-sig")

    by_mtn = summarize_by_mountain(events)
    by_mtn.to_csv(OUT_MOUNTAIN_SUMMARY, index=False, encoding="utf-8-sig")

    # 산불 1건당 대표 행(매칭 산 이름들을 합친 뷰)
    fire_view = (
        events.groupby("fire_id", as_index=False)
        .agg(
            datetime=("datetime", "first"),
            date=("date", "first"),
            hour=("hour", "first"),
            time=("time", "first"),
            fire_province=("fire_province", "first"),
            fire_city=("fire_city", "first"),
            fire_town=("fire_town", "first"),
            fire_village=("fire_village", "first"),
            fire_region=("fire_region", "first"),
            damage_area=("damage_area", "first"),
            cause=("cause", "first"),
            match_level=("match_level", "first"),
            matched_mountain_count=("matched_mountain_count", "first"),
            mountain_names=("mntn_nm", lambda s: ", ".join([x for x in dict.fromkeys(s) if x][:15])),
            mountain_ids=("mntn_id", lambda s: ", ".join([x for x in dict.fromkeys(s) if x][:15])),
            mountain_addresses=("mntn_add", lambda s: " || ".join([x for x in dict.fromkeys(s) if x][:5])),
        )
        .sort_values("datetime", ascending=False)
    )
    fire_view.to_csv(OUT_FIRE_VIEW, index=False, encoding="utf-8-sig")

    matched_fires = int((fire_view["match_level"] != "none").sum())
    town_matched = int((fire_view["match_level"] == "town").sum())
    city_matched = int((fire_view["match_level"] == "city").sum())

    recent = (
        events[events["mntn_nm"] != ""]
        .head(40)[
            [
                "datetime",
                "fire_region",
                "damage_area",
                "mntn_nm",
                "mntn_hght",
                "mntn_add",
                "match_level",
            ]
        ]
        .copy()
    )
    recent["datetime"] = recent["datetime"].astype(str)
    recent = recent.round(4)

    top_mountains = by_mtn.head(20).copy()
    for c in ["first_fire", "last_fire"]:
        if c in top_mountains.columns:
            top_mountains[c] = top_mountains[c].astype(str)
    top_mountains = top_mountains.round(4)

    # 시간대별: 매칭된 산불의 시간 분포
    timed = fire_view[fire_view["match_level"] != "none"].copy()
    timed["hour"] = pd.to_datetime(timed["datetime"], errors="coerce").dt.hour
    hour_counts = (
        timed["hour"].value_counts().reindex(range(24), fill_value=0).astype(int).tolist()
    )

    recent_fires = (
        fire_view[fire_view["match_level"] != "none"]
        .head(25)
        .copy()
    )
    recent_fires["datetime"] = recent_fires["datetime"].astype(str)
    recent_fires["date"] = recent_fires["date"].astype(str)

    summary = {
        "n_fires": int(len(fire)),
        "n_event_rows": int(len(events)),
        "fires_matched": matched_fires,
        "fires_matched_town": town_matched,
        "fires_matched_city": city_matched,
        "fires_unmatched": int(len(fire) - matched_fires),
        "n_mountains_linked": int(by_mtn.shape[0]),
        "match_rate_pct": round(matched_fires / max(len(fire), 1) * 100, 1),
        "hour_counts_matched": hour_counts,
        "recent_matches": recent.to_dict(orient="records"),
        "top_mountains_by_fire_events": top_mountains.to_dict(orient="records"),
        "recent_fires_with_names": recent_fires.round(4).to_dict(orient="records"),
        "notes": [
            "산 목록 출처: korea_mountains.json (전국 산 정보)",
            "산불 원본에 산 이름이 없어, 동일 읍면(우선)·시군구(보조)에 소재한 산을 후보로 연결",
            "match_level=town: 같은 읍면의 산 / city: 같은 시군구의 산 / none: 매칭 실패",
            "한 산불이 여러 산에 매칭될 수 있음(같은 읍면에 산이 여러 개)",
        ],
    }
    OUT_JSON.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")

    print("=== 산불 시점·장소 → 산 이름 매칭 ===")
    print(f"산불 {len(fire)}건 중 매칭 {matched_fires}건 ({summary['match_rate_pct']}%)")
    print(f"  읍면 매칭 {town_matched} / 시군구 매칭 {city_matched} / 실패 {summary['fires_unmatched']}")
    print(f"연결된 산 종류: {summary['n_mountains_linked']}")
    print("\n최근 매칭 예시 (산불 시각 | 산불장소 | 산이름 | 산소재지)")
    sample = events[events["mntn_nm"] != ""].head(12)
    for _, r in sample.iterrows():
        print(
            f"  {r['datetime']} | {r['fire_region']} | {r['mntn_nm']}({r['mntn_hght']}m) | {r['mntn_add'][:40]}"
        )
    print("\n산불 이벤트가 가장 많이 겹친 산 TOP8")
    if not by_mtn.empty:
        print(
            by_mtn.head(8)[
                ["mntn_nm", "mntn_hght", "fire_event_count", "first_fire", "last_fire", "mntn_add"]
            ].to_string(index=False)
        )
    print(f"\n저장: {OUT_EVENTS.name}, {OUT_FIRE_VIEW.name}, {OUT_MOUNTAIN_SUMMARY.name}, {OUT_JSON.name}")


if __name__ == "__main__":
    main()
