"""frontend/public/data 웹 JSON 용량 압축.

- admin-*: SVG path Douglas–Peucker 재단순화, 미사용 markers/fill 제거
- map-data: provinces 중복 제거, 산 카탈로그·details 슬림화

재실행해도 안전하게 동작 (이미 압축된 파일은 소폭만 줄어듦).
"""

from __future__ import annotations

import json
import math
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from paths import (
    ADMIN_EMD_JSON,
    ADMIN_SIDO_JSON,
    ADMIN_SIGUNGU_JSON,
    MAP_DATA_JSON,
)

NUM = re.compile(r"[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?")


def _dp(pts: list[tuple[float, float]], eps: float) -> list[tuple[float, float]]:
    if len(pts) <= 2:
        return pts
    ax, ay = pts[0]
    bx, by = pts[-1]
    dx, dy = bx - ax, by - ay
    denom = dx * dx + dy * dy or 1.0
    max_d = -1.0
    idx = 0
    for i in range(1, len(pts) - 1):
        px, py = pts[i]
        t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / denom))
        qx, qy = ax + t * dx, ay + t * dy
        d = math.hypot(px - qx, py - qy)
        if d > max_d:
            max_d = d
            idx = i
    if max_d > eps:
        left = _dp(pts[: idx + 1], eps)
        right = _dp(pts[idx:], eps)
        return left[:-1] + right
    return [pts[0], pts[-1]]


def _fmt(n: float, nd: int = 1) -> str:
    s = f"{n:.{nd}f}".rstrip("0").rstrip(".")
    return s if s else "0"


def simplify_svg_path(d: str, tol: float, nd: int = 1) -> str:
    if not d:
        return d
    cmds = re.findall(r"[MLZmlz]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?", d)
    rings: list[list[tuple[float, float]]] = []
    cur: list[tuple[float, float]] = []
    i = 0
    mode = "L"
    while i < len(cmds):
        tok = cmds[i]
        if tok in "MLml":
            mode = tok.upper()
            i += 1
            continue
        if tok in "Zz":
            if cur:
                rings.append(cur)
                cur = []
            i += 1
            continue
        if i + 1 >= len(cmds):
            break
        try:
            x = float(tok)
            y = float(cmds[i + 1])
        except ValueError:
            i += 1
            continue
        if mode == "M" and cur:
            rings.append(cur)
            cur = []
        cur.append((x, y))
        mode = "L"
        i += 2
    if cur:
        rings.append(cur)

    out: list[str] = []
    for ring in rings:
        if len(ring) < 3:
            continue
        closed = ring[0] == ring[-1]
        pts = ring[:-1] if closed and len(ring) > 1 else ring
        simp = _dp(pts, tol)
        if len(simp) < 3:
            continue
        if closed or ring[0] == ring[-1]:
            if simp[0] != simp[-1]:
                simp = simp + [simp[0]]
        out.append(f"M{_fmt(simp[0][0], nd)},{_fmt(simp[0][1], nd)}")
        for x, y in simp[1:]:
            out.append(f"L{_fmt(x, nd)},{_fmt(y, nd)}")
        out.append("Z")
    return "".join(out) if out else d


def _ring_extent(d: str) -> float:
    nums = [float(x) for x in NUM.findall(d)]
    if len(nums) < 4:
        return 0.0
    xs = nums[0::2]
    ys = nums[1::2]
    return max(max(xs) - min(xs), max(ys) - min(ys))


def path_tol_for(level: str, d: str) -> float:
    """viewBox 단위 허용 오차. 읍면동은 크기에 따라 조절."""
    if level == "sido":
        return 1.2
    if level == "sigungu":
        return 0.7
    extent = _ring_extent(d)
    if extent >= 40:
        return 0.55
    if extent >= 18:
        return 0.35
    if extent >= 8:
        return 0.22
    return 0.12


def compress_admin(path: Path) -> dict:
    raw_size = path.stat().st_size
    data = json.loads(path.read_text(encoding="utf-8"))
    level = str(data.get("level") or "")
    regions = []
    for r in data.get("regions") or []:
        item = {k: v for k, v in r.items() if k not in {"fill", "markers"}}
        d = item.get("d")
        if isinstance(d, str) and d:
            item["d"] = simplify_svg_path(d, path_tol_for(level, d), nd=1)
        # label 은 [x,y] 와 중복이지만 렌더러가 label 사용 → 유지
        regions.append(item)

    out = {
        "level": data.get("level"),
        "viewBox": data.get("viewBox"),
        "regions": regions,
        "markers": [],
        "meta": {
            **(data.get("meta") or {}),
            "n_regions": len(regions),
            "n_markers": 0,
        },
    }
    text = json.dumps(out, ensure_ascii=False, separators=(",", ":"))
    path.write_text(text, encoding="utf-8")
    new_size = path.stat().st_size
    print(
        f"{path.name}: {raw_size / 1e6:.2f} → {new_size / 1e6:.2f} MB "
        f"({100 * new_size / raw_size:.0f}%) · regions={len(regions)}"
    )
    return out


CATALOG_KEYS = (
    "id",
    "name",
    "height",
    "fire_count",
    "lon",
    "lat",
    "svg_x",
    "svg_y",
)


def _slim_mountain(m: dict, details_limit: int = 140) -> dict:
    out = {
        "id": m.get("id", ""),
        "name": m.get("name", ""),
        "height": m.get("height"),
        "address": m.get("address") or "",
        "details": _clip(m.get("details"), details_limit),
        "notable": _clip(m.get("notable"), 100),
        "admin": m.get("admin") or "",
        "admin_tel": m.get("admin_tel") or "",
        "fire_count": int(m.get("fire_count") or 0),
    }
    for k in ("lon", "lat", "svg_x", "svg_y"):
        v = m.get(k)
        if isinstance(v, (int, float)):
            out[k] = round(float(v), 5 if k in {"lon", "lat"} else 2)
    return out


def _clip(text: object, limit: int) -> str:
    if text is None:
        return ""
    s = str(text).strip()
    if len(s) <= limit:
        return s
    return s[: limit - 1].rstrip() + "…"


def _slim_catalog(items: object) -> list[dict]:
    if not isinstance(items, list):
        return []
    out = []
    for m in items:
        if not isinstance(m, dict):
            continue
        slim = {k: m[k] for k in CATALOG_KEYS if k in m}
        if "id" in slim or "name" in slim:
            out.append(slim)
    return out


def compress_map_data(path: Path) -> None:
    raw_size = path.stat().st_size
    data = json.loads(path.read_text(encoding="utf-8"))

    regions = []
    for r in data.get("regions") or data.get("provinces") or []:
        item = dict(r)
        item["catalog_mountains"] = _slim_catalog(item.get("catalog_mountains"))
        item["top_mountains"] = _slim_catalog(item.get("top_mountains"))
        regions.append(item)

    mountains = {}
    for mid, m in (data.get("mountains") or {}).items():
        if isinstance(m, dict):
            mountains[mid] = _slim_mountain(m)

    history = {}
    for code, events in (data.get("history") or {}).items():
        if not isinstance(events, list):
            continue
        slim_events = []
        for ev in events:
            if not isinstance(ev, dict):
                continue
            e = {
                "datetime": ev.get("datetime", ""),
                "region": ev.get("region", ""),
                "city": ev.get("city", ""),
                "town": ev.get("town", ""),
                "village": ev.get("village", ""),
                "damage_area": ev.get("damage_area", 0),
                "mountains": ev.get("mountains", ""),
                "match_level": ev.get("match_level", ""),
            }
            # mountain_list 는 전체 객체 복제 → id만 남기면 프론트가 index로 보강
            ml = ev.get("mountain_list")
            if isinstance(ml, list) and ml:
                e["mountain_list"] = [
                    {"id": m.get("id"), "name": m.get("name"), "fire_count": m.get("fire_count", 0)}
                    for m in ml
                    if isinstance(m, dict)
                ]
            slim_events.append(e)
        history[code] = slim_events

    out = {
        "meta": data.get("meta") or {},
        # regions 와 동일 내용 중복(~2.5MB) → 빈 배열 유지(타입 호환)
        "provinces": [],
        "regions": regions,
        "history": history,
        "mountains": mountains,
    }
    text = json.dumps(out, ensure_ascii=False, separators=(",", ":"))
    path.write_text(text, encoding="utf-8")
    new_size = path.stat().st_size
    print(
        f"{path.name}: {raw_size / 1e6:.2f} → {new_size / 1e6:.2f} MB "
        f"({100 * new_size / raw_size:.0f}%) · regions={len(regions)} mountains={len(mountains)}"
    )


def main() -> None:
    for p in (ADMIN_SIDO_JSON, ADMIN_SIGUNGU_JSON, ADMIN_EMD_JSON):
        if p.exists():
            compress_admin(p)
        else:
            print(f"skip missing {p}")
    if MAP_DATA_JSON.exists():
        compress_map_data(MAP_DATA_JSON)
    else:
        print(f"skip missing {MAP_DATA_JSON}")


if __name__ == "__main__":
    main()
