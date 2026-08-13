"""행정구역 법정동명 매칭 — 접미사(시/군/구/읍/면/동/리)를 구분해 동명 충돌을 막는다.

예: 경기도 양주시 장흥면 ≠ 전라남도 장흥군
    은현면 선택 시 양주시 전체가 아니라 은현면만
"""

from __future__ import annotations

import re

ADMIN_SUFFIXES = (
    "특별자치시",
    "광역시",
    "특별시",
    "특별자치도",
    "자치도",
    "읍",
    "면",
    "동",
    "리",
    "가",
    "시",
    "군",
    "구",
)

_BLANK = {"", "unknown", "nan", "none", "null"}


def compact_name(name: str) -> str:
    return re.sub(r"\s+", "", str(name or "").strip())


def is_blank(name: object) -> bool:
    t = str(name or "").strip()
    return not t or t.lower() in _BLANK


def admin_suffix(name: str) -> str:
    n = compact_name(name)
    for sfx in ADMIN_SUFFIXES:
        if n.endswith(sfx):
            return sfx
    return ""


def strip_admin(name: str) -> str:
    """비교용 어간. 접미사는 한 단계만 뗀다."""
    n = compact_name(name)
    n = re.sub(r"(특별자치시|광역시|특별시|특별자치도)$", "", n)
    n = re.sub(r"(시|군|구|읍|면|동|리|가)$", "", n)
    return n


def names_same_unit(a: str, b: str) -> bool:
    """같은 행정 단위인지. 장흥면 vs 장흥군처럼 접미사가 다르면 False.

    한쪽만 접미사가 없으면 어간이 같을 때 허용 (원본 '장흥' ≈ '장흥면').
    """
    ca, cb = compact_name(a), compact_name(b)
    if not ca or not cb or is_blank(ca) or is_blank(cb):
        return False
    if ca == cb:
        return True
    sa, sb = admin_suffix(ca), admin_suffix(cb)
    if sa and sb and sa != sb:
        return False
    return strip_admin(ca) == strip_admin(cb)


def is_redundant_child(parent: str, child: str) -> bool:
    """'갑동 > 갑', '유양동 > 유양' 처럼 상위 법정동의 어간 반복이면 True.

    '은현면 > 선암리' 처럼 실제 리는 유지.
    """
    p, c = compact_name(parent), compact_name(child)
    if not p or not c or is_blank(p) or is_blank(c):
        return False
    if p == c:
        return True
    child_sfx = admin_suffix(c)
    if child_sfx in {"리", "가"}:
        return False
    # 상동동 > 상동, 갑동 > 갑 (한 단계 접미를 뗀 값이 하위와 같음)
    if strip_admin(p) == c:
        return True
    if not child_sfx and strip_admin(p) == strip_admin(c):
        return True
    return False


def collapse_redundant_parts(parts: list[str]) -> list[str]:
    out = [p for p in parts if not is_blank(p)]
    while len(out) >= 2 and is_redundant_child(out[-2], out[-1]):
        out.pop()
    return out


def count_city_fires(by_city: dict[str, int], province: str, city_name: str) -> int:
    key = f"{province}|{strip_admin(city_name)}"
    c = int(by_city.get(key, 0))
    if c:
        return c
    if " " in city_name:
        return int(by_city.get(f"{province}|{strip_admin(city_name.split()[-1])}", 0))
    return 0


def count_town_fires(
    by_town: dict[str, int],
    province: str,
    city_name: str,
    town_name: str,
) -> int:
    """시군구로 한정한 뒤, 읍·면·동 접미사까지 구분해 건수 집계."""
    if not city_name or not town_name:
        return 0
    prefix = f"{province}|{strip_admin(city_name)}|"
    exact = 0
    stem_only = 0
    sibling_stems: set[str] = set()
    for k, cnt in by_town.items():
        if not k.startswith(prefix):
            continue
        town = k[len(prefix) :]
        if compact_name(town) == compact_name(town_name):
            exact += int(cnt)
            continue
        if names_same_unit(town, town_name):
            if admin_suffix(town):
                exact += int(cnt)
            else:
                stem_only += int(cnt)
        if admin_suffix(town):
            sibling_stems.add(strip_admin(town))
    if exact:
        return exact
    # 접미사 없는 원본('장흥')은 같은 시군구에 동명 단위가 하나일 때만 사용
    stem = strip_admin(town_name)
    if stem_only and sibling_stems <= {stem}:
        return stem_only
    return 0
