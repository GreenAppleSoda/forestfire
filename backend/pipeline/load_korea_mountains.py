"""
산 목록 정리 스크립트
korea_mountains.json(전국 산 정보) → mountain_data / mountain_location CSV.

기존 OpenAPI 수집본(약 1.3천)보다 커버리지가 넓어 산불↔산 매칭 품질이 올라갑니다.
주소 파싱은 get_mountain_data.parse_location_chunk / expand_locations를 재사용합니다.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import json
import re

import pandas as pd

from get_mountain_data import expand_locations
from paths import (
    KOREA_MOUNTAINS_JSON,
    MOUNTAIN_DATA,
    MOUNTAIN_LOCATION,
    ROOT,
    ensure_dirs,
)

SRC = KOREA_MOUNTAINS_JSON


def clean_text(value: object) -> str:
    if value is None:
        return ""
    text = str(value).replace("\r\n", "\n").replace("\r", "\n").strip()
    if text in {"", "( - )", "(-)", "-", "nan", "None"}:
        return ""
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text


def load_raw() -> pd.DataFrame:
    raw = json.loads(SRC.read_text(encoding="utf-8"))
    rows = []
    for item in raw:
        mntn_id = str(item.get("mntilistno") or "").strip()
        name = clean_text(item.get("mntiname"))
        if not mntn_id or not name:
            continue
        height_raw = str(item.get("mntihigh") or "").strip()
        try:
            height = float(height_raw) if height_raw else None
        except ValueError:
            height = None
        details = clean_text(item.get("mntidetails"))
        notable = clean_text(item.get("mntitop"))
        summary = clean_text(item.get("mntisummary"))
        rows.append(
            {
                "mntn_id": mntn_id,
                "mntn_nm": name,
                "mntn_add": clean_text(item.get("mntiadd")),
                "mntn_hght": height,
                "mntn_details": details,
                "mntn_notable": notable,
                "mntn_summary": summary,
                "mntn_admin": clean_text(item.get("mntiadmin")),
                "mntn_admin_tel": clean_text(item.get("mntiadminnum")),
                "mntn_subtitle": clean_text(item.get("mntisname")),
                "mntn_updated": clean_text(item.get("mntinfdt")),
                "source": "korea_mountains.json",
            }
        )
    df = pd.DataFrame(rows).drop_duplicates(subset=["mntn_id"], keep="first")
    return df


def expand_df(df: pd.DataFrame) -> pd.DataFrame:
    expanded = []
    for _, row in df.iterrows():
        locs = expand_locations(str(row["mntn_add"]))
        base = {
            "mntn_id": row["mntn_id"],
            "mntn_nm": row["mntn_nm"],
            "mntn_hght": row["mntn_hght"],
            "mntn_add": row["mntn_add"],
            "mntn_details": row["mntn_details"],
            "mntn_notable": row["mntn_notable"],
            "mntn_summary": row["mntn_summary"],
            "mntn_admin": row["mntn_admin"],
            "mntn_admin_tel": row["mntn_admin_tel"],
        }
        if not locs:
            expanded.append(
                {
                    **base,
                    "province": "Unknown",
                    "city": "Unknown",
                    "town": "Unknown",
                    "loc_raw": "",
                    "city_key": "Unknown Unknown",
                    "town_key": "Unknown Unknown Unknown",
                }
            )
            continue
        for loc in locs:
            expanded.append(
                {
                    **base,
                    "province": loc["province"],
                    "city": loc["city"],
                    "town": loc["town"],
                    "loc_raw": loc["loc_raw"],
                    "city_key": f"{loc['province']} {loc['city']}",
                    "town_key": f"{loc['province']} {loc['city']} {loc['town']}",
                }
            )
    return pd.DataFrame(expanded)


def main() -> None:
    ensure_dirs()
    if not SRC.exists():
        raise FileNotFoundError(f"산 정보 파일 없음: {SRC}")

    df = load_raw()
    df.to_csv(MOUNTAIN_DATA, index=False, encoding="utf-8-sig")

    loc = expand_df(df)
    loc.to_csv(MOUNTAIN_LOCATION, index=False, encoding="utf-8-sig")

    known = loc[loc["province"] != "Unknown"]
    with_details = int((df["mntn_details"].astype(str).str.len() > 0).sum())
    with_notable = int((df["mntn_notable"].astype(str).str.len() > 0).sum())

    print(f"원본: {SRC.name}")
    print(f"산 정보: {MOUNTAIN_DATA} ({len(df)}산, 설명 {with_details}, 명산소개 {with_notable})")
    print(f"소재지 펼침: {MOUNTAIN_LOCATION} ({len(loc)}행, 파싱성공 {len(known)})")
    print("시도별 산(펼침) 건수:")
    print(known["province"].value_counts().to_string())


if __name__ == "__main__":
    main()
