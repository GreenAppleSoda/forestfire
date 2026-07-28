"""법정동 lookup 으로 산불 지역명(약칭)을 공식명으로 정규화."""

from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path

from paths import DATA_PROCESSED_ETL, FRONTEND_PUBLIC_DATA

LOOKUP_CANDIDATES = [
    DATA_PROCESSED_ETL / "legal_dong_lookup.json",
    FRONTEND_PUBLIC_DATA / "legal-dong-lookup.json",
]


def strip_key(name: str) -> str:
    s = re.sub(r"\s+", "", str(name).strip())
    s = re.sub(
        r"(특별자치시|광역시|특별시|특별자치도|자치도)$",
        "",
        s,
    )
    s = re.sub(r"(시|군|구|읍|면|동|리|가)$", "", s)
    return s


def _is_blank(s: str) -> bool:
    t = str(s or "").strip()
    return not t or t.lower() == "unknown" or t in ("nan", "None")


@lru_cache(maxsize=1)
def load_lookup() -> dict | None:
    for p in LOOKUP_CANDIDATES:
        if p.exists():
            return json.loads(p.read_text(encoding="utf-8"))
    return None


def _resolve_sido(lookup: dict, raw: str) -> str:
    sido = lookup.get("sido") or {}
    if raw in sido:
        return sido[raw]
    sk = strip_key(raw)
    if sk in sido:
        return sido[sk]
    return raw


def _resolve_child(
    table: dict[str, str],
    parent: str,
    raw: str,
) -> str:
    if not raw:
        return raw
    # parent 공식명 기준
    for key in (f"{parent}|{raw}", f"{parent}|{strip_key(raw)}"):
        if key in table:
            return table[key]
    return raw


def normalize_parts(
    province: str = "",
    city: str = "",
    town: str = "",
    village: str = "",
    lookup: dict | None = None,
) -> list[str]:
    """province/city/town/village → 공식명 리스트 (빈·Unknown 제외)."""
    if lookup is None:
        lookup = load_lookup()
    parts_in = [province, city, town, village]
    cleaned = [p.strip() for p in parts_in if not _is_blank(p)]
    if not cleaned:
        return []
    if not lookup:
        return cleaned

    out: list[str] = []
    sido_map = lookup.get("sido") or {}
    sig_map = lookup.get("sigungu") or {}
    emd_map = lookup.get("emd") or {}
    li_map = lookup.get("li") or {}

    sido = _resolve_sido(lookup, cleaned[0])
    out.append(sido)

    if len(cleaned) < 2:
        return out
    sig = _resolve_child(sig_map, sido, cleaned[1])
    # parent가 약칭으로 들어온 경우 대비
    if sig == cleaned[1]:
        for alt in {sido, cleaned[0], strip_key(sido)}:
            hit = _resolve_child(sig_map, alt, cleaned[1])
            if hit != cleaned[1]:
                sig = hit
                break
    out.append(sig)

    if len(cleaned) < 3:
        return out
    emd = _resolve_child(emd_map, f"{sido}|{sig}", cleaned[2])
    if emd == cleaned[2]:
        # 시군구도 strip 형태로 재시도
        for sig_alt in {sig, strip_key(sig), cleaned[1]}:
            hit = _resolve_child(emd_map, f"{sido}|{sig_alt}", cleaned[2])
            if hit != cleaned[2]:
                emd = hit
                break
    out.append(emd)

    if len(cleaned) < 4:
        return out
    li = _resolve_child(li_map, f"{sido}|{sig}|{emd}", cleaned[3])
    if li == cleaned[3]:
        for emd_alt in {emd, strip_key(emd), cleaned[2]}:
            hit = _resolve_child(li_map, f"{sido}|{sig}|{emd_alt}", cleaned[3])
            if hit != cleaned[3]:
                li = hit
                break
    out.append(li)
    return out


def format_region_path(
    *parts: object,
    lookup: dict | None = None,
) -> str:
    """표시/저장용 region_path. Unknown 제외 + 법정동 공식명."""
    vals = [str(p or "").strip() for p in parts]
    # 이미 "a > b > c" 한 덩어리로 온 경우
    if len(vals) == 1 and ">" in vals[0]:
        vals = [p.strip() for p in vals[0].split(">")]
    while len(vals) < 4:
        vals.append("")
    return " > ".join(normalize_parts(*vals[:4], lookup=lookup))


def normalize_region_path_string(path: str, lookup: dict | None = None) -> str:
    return format_region_path(path, lookup=lookup)
