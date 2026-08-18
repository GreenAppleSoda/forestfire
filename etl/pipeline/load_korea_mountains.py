"""
산 목록 정리 스크립트
korea_mountains.json(전국 산 정보) → mountain_data / mountain_location CSV.

원본은 mountain_crawlling.py 가 mntInfoOpenAPI2 로 수집한 korea_mountains.json.
소재지 문자열을 시도·시군구·읍면으로 펼쳐 산불↔산 매칭에 씁니다.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import json
import re

import pandas as pd

from paths import (
    KOREA_MOUNTAINS_JSON,
    MOUNTAIN_DATA,
    MOUNTAIN_LOCATION,
    ensure_dirs,
)

SRC = KOREA_MOUNTAINS_JSON

PROVINCE_MAP = {
    "서울특별시": "서울",
    "서울시": "서울",
    "서울": "서울",
    "부산광역시": "부산",
    "부산시": "부산",
    "부산": "부산",
    "대구광역시": "대구",
    "대구시": "대구",
    "대구": "대구",
    "인천광역시": "인천",
    "인천시": "인천",
    "인천": "인천",
    "광주광역시": "광주",
    "광주시": "광주",
    "광주": "광주",
    "대전광역시": "대전",
    "대전시": "대전",
    "대전": "대전",
    "울산광역시": "울산",
    "울산시": "울산",
    "울산": "울산",
    "세종특별자치시": "세종",
    "세종시": "세종",
    "세종": "세종",
    "경기도": "경기",
    "경기": "경기",
    "강원특별자치도": "강원",
    "강원도": "강원",
    "강원": "강원",
    "충청북도": "충북",
    "충북": "충북",
    "충청남도": "충남",
    "충남": "충남",
    "전북특별자치도": "전북",
    "전라북도": "전북",
    "전북": "전북",
    "전라남도": "전남",
    "전남": "전남",
    "경상북도": "경북",
    "경북": "경북",
    "경상남도": "경남",
    "경남": "경남",
    "제주특별자치도": "제주",
    "제주도": "제주",
    "제주": "제주",
}


def normalize_city(name: str) -> str:
    name = name.strip()
    # 산불 데이터는 '가평','양평'처럼 시·군·구 접미사 없음
    name = re.sub(r"(특별자치시|광역시|특별시)$", "", name)
    name = re.sub(r"(시|군|구)$", "", name)
    return name.strip()


def normalize_town(name: str) -> str:
    name = name.strip()
    name = re.sub(r"(읍|면|동|리|가)$", "", name)
    return name.strip()


def parse_location_chunk(chunk: str) -> dict | None:
    """예: '경기도 가평군 북면' → province/city/town."""
    chunk = chunk.strip()
    if not chunk or chunk in {"-", "&nbsp;", "&amp;nbsp;"}:
        return None
    # HTML 엔티티 잔여 제거
    chunk = re.sub(r"&amp;|&nbsp;|nbsp;", " ", chunk)
    chunk = re.sub(r"\s+", " ", chunk).strip()
    parts = chunk.split(" ")
    if not parts:
        return None

    province = PROVINCE_MAP.get(parts[0])
    if province is None:
        # '경기 가평군'처럼 이미 짧은 시도명인 경우
        province = PROVINCE_MAP.get(parts[0].replace("도", "").replace("특별자치", ""))
    if province is None and parts[0] in PROVINCE_MAP.values():
        province = parts[0]
    if province is None:
        return None

    city = normalize_city(parts[1]) if len(parts) > 1 else ""
    town = normalize_town(parts[2]) if len(parts) > 2 else ""
    return {
        "province": province,
        "city": city or "Unknown",
        "town": town or "Unknown",
        "loc_raw": chunk,
    }


def expand_locations(mntn_add: str) -> list[dict]:
    """여러 시군에 걸친 소재지를 분리. 시도 생략·ㆍ구분도 처리."""
    if not mntn_add:
        return []
    normalized = mntn_add.replace("ㆍ", ",").replace("·", ",").replace("・", ",")
    chunks = re.split(r"[,，/]", normalized)
    rows = []
    seen = set()
    last_province_token = None
    last_city_token = None

    for chunk in chunks:
        chunk = chunk.strip()
        if not chunk:
            continue
        parts = chunk.split()
        first = parts[0]
        has_province = first in PROVINCE_MAP or first in PROVINCE_MAP.values()
        town_only = bool(re.search(r"(읍|면|동|리)$", first)) and not re.search(
            r"(시|군|구)$", first
        )

        if not has_province and last_province_token:
            if town_only and last_city_token:
                chunk = f"{last_province_token} {last_city_token} {chunk}"
            else:
                chunk = f"{last_province_token} {chunk}"
        elif has_province:
            last_province_token = first

        parsed = parse_location_chunk(chunk)
        if not parsed:
            continue
        # 시군 토큰 기억 (다음 읍면-only 청크용)
        rebuilt = chunk.split()
        if len(rebuilt) >= 2 and re.search(r"(시|군|구)$", rebuilt[1]):
            last_city_token = rebuilt[1]
            if rebuilt[0] in PROVINCE_MAP or rebuilt[0] in PROVINCE_MAP.values():
                last_province_token = rebuilt[0]

        key = (parsed["province"], parsed["city"], parsed["town"])
        if key in seen:
            continue
        seen.add(key)
        rows.append(parsed)
    return rows


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
