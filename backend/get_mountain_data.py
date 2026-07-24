"""
산림청 산 정보 조회 OpenAPI로 산 목록을 수집합니다.

- 공식 서비스 URL: api.forest.go.kr (data.go.kr 프록시 URL은 500 나는 경우 있음)
- 응답 소재지 필드: mntninfopoflc (요청 필터명은 mntnAdd)
- 산이 여러 시군에 걸치면 쉼표로 나뉜 소재지를 행으로 펼칩니다.
"""

from __future__ import annotations

import os
import re
import time
import xml.etree.ElementTree as ET

import pandas as pd
import requests

from paths import MOUNTAIN_DATA, MOUNTAIN_LOCATION, ensure_dirs

OUT_CSV = MOUNTAIN_DATA
OUT_EXPANDED = MOUNTAIN_LOCATION

# data.go.kr 발급 키. 환경변수 SERVICE_KEY가 있으면 우선 사용.
SERVICE_KEY = os.environ.get(
    "SERVICE_KEY",
    "cbcf325fcf4c5a1f3352c77578f0690923bf79d512e38ad20b759d6f2d77d2b1",
)
URL = "http://api.forest.go.kr/openapi/service/trailInfoService/getforeststoryservice"
PAGE_SIZE = 100

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


def text(el: ET.Element | None, tag: str) -> str:
    if el is None:
        return ""
    node = el.find(tag)
    if node is None or node.text is None:
        return ""
    return node.text.strip()


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


def fetch_page(page_no: int, num_rows: int = PAGE_SIZE) -> tuple[list[dict], int]:
    resp = requests.get(
        URL,
        params={
            "ServiceKey": SERVICE_KEY,
            "pageNo": str(page_no),
            "numOfRows": str(num_rows),
        },
        timeout=60,
    )
    resp.raise_for_status()
    root = ET.fromstring(resp.content)
    result = root.findtext(".//resultCode")
    if result not in (None, "00", "0"):
        msg = root.findtext(".//resultMsg")
        raise RuntimeError(f"API error page={page_no}: {result} {msg}")

    total = int(root.findtext(".//totalCount") or "0")
    items = []
    for item in root.findall(".//item"):
        # 응답 필드명은 소문자 (요청 필터 mntnAdd ≠ 응답 mntninfopoflc)
        mntn_add = text(item, "mntninfopoflc") or text(item, "mntnAdd")
        items.append(
            {
                "mntn_id": text(item, "mntnid"),
                "mntn_nm": text(item, "mntnnm") or text(item, "mntnNm"),
                "mntn_add": mntn_add,
                "mntn_hght": text(item, "mntninfohght") or text(item, "mntnHght"),
                "mntn_subtitle": text(item, "mntnsbttlinfo"),
            }
        )
    return items, total


def fetch_all() -> pd.DataFrame:
    first, total = fetch_page(1)
    rows = list(first)
    pages = max(1, (total + PAGE_SIZE - 1) // PAGE_SIZE)
    print(f"총 {total}건, {pages}페이지 수집 시작")
    for page in range(2, pages + 1):
        time.sleep(0.15)
        items, _ = fetch_page(page)
        rows.extend(items)
        print(f"  page {page}/{pages} (+{len(items)})")
    df = pd.DataFrame(rows)
    df["mntn_hght"] = pd.to_numeric(df["mntn_hght"], errors="coerce")
    return df.drop_duplicates(subset=["mntn_id"], keep="first")


def expand_df(df: pd.DataFrame) -> pd.DataFrame:
    expanded = []
    for _, row in df.iterrows():
        locs = expand_locations(str(row["mntn_add"]))
        if not locs:
            expanded.append(
                {
                    "mntn_id": row["mntn_id"],
                    "mntn_nm": row["mntn_nm"],
                    "mntn_hght": row["mntn_hght"],
                    "mntn_add": row["mntn_add"],
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
                    "mntn_id": row["mntn_id"],
                    "mntn_nm": row["mntn_nm"],
                    "mntn_hght": row["mntn_hght"],
                    "mntn_add": row["mntn_add"],
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
    # 이미 CSV가 있으면 재수집 없이 파싱만 갱신 (전체 재수집: REFETCH=1)
    if OUT_CSV.exists() and os.environ.get("REFETCH") != "1":
        print(f"기존 {OUT_CSV.name} 사용 (재수집은 REFETCH=1)")
        df = pd.read_csv(OUT_CSV)
        df["mntn_hght"] = pd.to_numeric(df["mntn_hght"], errors="coerce")
    else:
        df = fetch_all()
        df.to_csv(OUT_CSV, index=False, encoding="utf-8-sig")

    loc = expand_df(df)
    loc.to_csv(OUT_EXPANDED, index=False, encoding="utf-8-sig")
    print(f"산 정보: {OUT_CSV} ({len(df)}산)")
    print(f"소재지 펼침: {OUT_EXPANDED} ({len(loc)}행)")
    print("시도별 산(펼침) 건수:")
    print(loc["province"].value_counts().head(12).to_string())


if __name__ == "__main__":
    main()
