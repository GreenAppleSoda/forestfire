"""
시도/시군구/읍면동 shapefile → 웹용 레이어 + 산불 확률 마커.

출력 (frontend/public/data/):
  admin-sido.json, admin-sigungu.json, admin-emd.json
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import json
import math
import re
from collections import defaultdict

import pandas as pd
import shapefile

from paths import FRONTEND_PUBLIC_DATA, GEO_DIR, REFINED_WILDFIRE, ensure_dirs

OUT_DIR = FRONTEND_PUBLIC_DATA

XMIN, YMIN = 740000.0, 1450000.0
XMAX, YMAX = 1395000.0, 2075000.0
WIDTH, HEIGHT = 800, 900
PAD = 24

PREFIX_TO_PROV = {
    "11": "서울",
    "26": "부산",
    "27": "대구",
    "28": "인천",
    "30": "대전",
    "31": "울산",
    "36": "세종",
    "41": "경기",
    "43": "충북",
    "44": "충남",
    "47": "경북",
    "48": "경남",
    "50": "제주",
    "51": "강원",
    "52": "전북",
}
GWANGJU_SIG = {"12210", "12240", "12270", "12300", "12330"}

PROV_FULL = {
    "서울": "서울특별시",
    "부산": "부산광역시",
    "대구": "대구광역시",
    "인천": "인천광역시",
    "광주": "광주광역시",
    "대전": "대전광역시",
    "울산": "울산광역시",
    "세종": "세종특별자치시",
    "경기": "경기도",
    "강원": "강원특별자치도",
    "충북": "충청북도",
    "충남": "충청남도",
    "전북": "전북특별자치도",
    "전남": "전라남도",
    "경북": "경상북도",
    "경남": "경상남도",
    "제주": "제주특별자치도",
}

YEARS = 15.5  # 2011-01 ~ 2026-06 대략 (prob_from_count용)


def to_svg(x: float, y: float) -> tuple[float, float]:
    sx = PAD + (x - XMIN) / (XMAX - XMIN) * (WIDTH - 2 * PAD)
    sy = PAD + (YMAX - y) / (YMAX - YMIN) * (HEIGHT - 2 * PAD)
    return round(sx, 2), round(sy, 2)


def strip_admin(name: str) -> str:
    name = re.sub(r"\s+", "", str(name).strip())
    name = re.sub(r"(특별자치시|광역시|특별시|특별자치도)$", "", name)
    name = re.sub(r"(시|군|구|읍|면|동|리)$", "", name)
    return name


def simplify_ring(points: list[tuple[float, float]], tol: float) -> list[tuple[float, float]]:
    if len(points) <= 3:
        return points

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

    out = _dp(points, tol)
    if out[0] != out[-1]:
        out.append(out[0])
    return out


def path_tolerance(shape, level: str, base_tol: float) -> float:
    """행정구역 크기에 따라 단순화 강도 조절 — 과도한 축소로 빈 구멍 생기는 것 방지."""
    if level != "emd":
        return base_tol
    b = shape.bbox
    extent = max(b[2] - b[0], b[3] - b[1])
    if extent >= 20000:
        return 0.32
    if extent >= 8000:
        return 0.18
    return 0.08


def shape_to_svg_path(shape, tol: float) -> str | None:
    pts = shape.points
    parts = list(shape.parts) + [len(pts)]
    cmds: list[str] = []
    for i in range(len(parts) - 1):
        ring = [to_svg(x, y) for x, y in pts[parts[i] : parts[i + 1]]]
        if len(ring) < 4:
            continue
        ring = simplify_ring(ring, tol)
        if len(ring) < 4:
            continue
        cmds.append(f"M{ring[0][0]},{ring[0][1]}")
        for x, y in ring[1:]:
            cmds.append(f"L{x},{y}")
        cmds.append("Z")
    return "".join(cmds) if cmds else None


def centroid_tm(shape) -> tuple[float, float]:
    b = shape.bbox
    return (b[0] + b[2]) / 2, (b[1] + b[3]) / 2


def resolve_province_from_code(code: str) -> str:
    pref = code[:2]
    if pref != "12":
        return PREFIX_TO_PROV.get(pref, "")
    sig5 = code[:5] if len(code) >= 5 else code
    return "광주" if sig5 in GWANGJU_SIG else "전남"


def prob_from_count(count: int) -> float:
    """절대 발생 건수 기반 확률 — 행정 단위마다 동일한 척도."""
    if count <= 0:
        return 0.04
    annual = count / YEARS
    p = 1.0 - math.exp(-annual * 0.8)
    return round(min(0.94, max(0.06, p)), 4)


def _hsl_to_rgb(h: float, s: float, l: float) -> tuple[int, int, int]:
    sn, ln = s / 100.0, l / 100.0
    c = (1.0 - abs(2 * ln - 1)) * sn
    x = c * (1.0 - abs((h / 60.0) % 2 - 1))
    m = ln - c / 2
    if h < 60:
        r, g, b = c, x, 0
    elif h < 120:
        r, g, b = x, c, 0
    elif h < 180:
        r, g, b = 0, c, x
    elif h < 240:
        r, g, b = 0, x, c
    elif h < 300:
        r, g, b = x, 0, c
    else:
        r, g, b = c, 0, x
    return (
        int(round((r + m) * 255)),
        int(round((g + m) * 255)),
        int(round((b + m) * 255)),
    )


_RISK_STOPS = [
    (0.0, 224, 76, 48),
    (0.22, 199, 89, 58),
    (0.48, 45, 93, 52),
    (0.72, 25, 95, 50),
    (1.0, 0, 72, 46),
]


def prob_color(prob: float) -> str:
    t = max(0.0, min(1.0, prob))
    for i in range(len(_RISK_STOPS) - 1):
        t0, h0, s0, l0 = _RISK_STOPS[i]
        t1, h1, s1, l1 = _RISK_STOPS[i + 1]
        if t <= t1 or i == len(_RISK_STOPS) - 2:
            u = 0.0 if t1 == t0 else (t - t0) / (t1 - t0)
            h = h0 + (h1 - h0) * u
            s = s0 + (s1 - s0) * u
            l = l0 + (l1 - l0) * u
            r, g, b = _hsl_to_rgb(h, s, l)
            return f"#{r:02X}{g:02X}{b:02X}"
    r, g, b = _hsl_to_rgb(_RISK_STOPS[-1][1], _RISK_STOPS[-1][2], _RISK_STOPS[-1][3])
    return f"#{r:02X}{g:02X}{b:02X}"


def apply_prob(item: dict, prob: float) -> None:
    item["prob"] = prob
    item["color"] = prob_color(prob)
    item["r"] = round(3.2 + 7.5 * (prob**0.85), 2)


def roll_up_from_children(
    parents: list[dict], children: list[dict], key_fn
) -> None:
    buckets: dict[str, list[float]] = defaultdict(list)
    for c in children:
        buckets[key_fn(c)].append(c["prob"])
    for p in parents:
        probs = buckets.get(key_fn(p), [])
        if probs:
            apply_prob(p, round(sum(probs) / len(probs), 4))


def load_fires() -> pd.DataFrame:
    df = pd.read_csv(REFINED_WILDFIRE)
    for c in ["province", "city", "town", "village"]:
        df[c] = df[c].fillna("").astype(str).str.strip()
    return df[df["province"].ne("") & df["province"].ne("Unknown")]


def build_fire_indexes(fires: pd.DataFrame):
    by_prov = fires.groupby("province").size().to_dict()
    by_city: dict[str, int] = defaultdict(int)
    by_town_name: dict[str, int] = defaultdict(int)
    by_village_name: dict[str, int] = defaultdict(int)

    for _, r in fires.iterrows():
        p, c, t, v = r["province"], r["city"], r["town"], r["village"]
        by_city[f"{p}|{strip_admin(c)}"] += 1
        if t and t != "Unknown":
            by_town_name[f"{p}|{strip_admin(t)}"] += 1
        if v and v != "Unknown":
            by_village_name[f"{p}|{strip_admin(v)}"] += 1

    return by_prov, by_city, by_town_name, by_village_name


def process_level(
    folder: str,
    shp_name: str,
    level: str,
    code_field: str,
    name_field: str,
    tol: float,
    fires_idx,
    include_paths: bool,
) -> dict:
    by_prov, by_city, by_town_name, by_village_name = fires_idx
    sf = shapefile.Reader(str(GEO_DIR / folder / shp_name), encoding="cp949")
    fields = [f[0] for f in sf.fields[1:]]
    code_i = fields.index(code_field)
    name_i = fields.index(name_field)

    rows = []
    for shape, rec in zip(sf.shapes(), sf.records()):
        code = str(rec[code_i]).strip()
        name = str(rec[name_i]).strip()
        prov = resolve_province_from_code(code)

        if level == "sido":
            raw = name
            for k, full in PROV_FULL.items():
                if full in raw:
                    prov = k
                    break
            if "광주" in raw and "전남" in raw:
                prov = "전남"
            elif not prov and "광주" in raw:
                prov = "광주"

        sx, sy = to_svg(*centroid_tm(shape))
        n = strip_admin(name)
        count = 0
        if level == "sido":
            count = int(by_prov.get(prov, 0))
        elif level == "sigungu":
            count = int(by_city.get(f"{prov}|{n}", 0))
            if count == 0 and " " in name:
                count = int(by_city.get(f"{prov}|{strip_admin(name.split()[-1])}", 0))
        elif level == "emd":
            prov = resolve_province_from_code(code[:5] if len(code) >= 5 else code) or prov
            count = int(by_town_name.get(f"{prov}|{n}", 0))
        else:
            count = int(by_village_name.get(f"{prov}|{n}", 0))

        d = (
            shape_to_svg_path(shape, tol=path_tolerance(shape, level, tol))
            if include_paths
            else None
        )
        rows.append(
            {
                "code": code,
                "name": name,
                "province": prov,
                "province_name": PROV_FULL.get(prov, ""),
                "x": sx,
                "y": sy,
                "fire_count": count,
                "d": d,
            }
        )

    regions, markers = [], []
    for r in rows:
        prob = prob_from_count(r["fire_count"])
        color = prob_color(prob)
        radius = round(3.2 + 7.5 * (prob**0.85), 2)
        item = {
            "code": r["code"],
            "name": r["name"],
            "province": r["province"],
            "province_name": r["province_name"],
            "fire_count": r["fire_count"],
            "prob": prob,
            "color": color,
            "x": r["x"],
            "y": r["y"],
            "r": radius,
        }
        markers.append(item)
        if include_paths and r["d"]:
            regions.append(
                {
                    **item,
                    "d": r["d"],
                    "fill": color,
                    "label": [r["x"], r["y"]],
                }
            )

    return {
        "level": level,
        "viewBox": [WIDTH, HEIGHT],
        "regions": regions,
        "markers": markers,
        "meta": {
            "n_regions": len(regions),
            "n_markers": len(markers),
            "max_fire_count": int(max((r["fire_count"] for r in rows), default=0)),
            "prob_note": "P(향후 1년 내 산불 1건+) 추정치 · 과거 발생률 기반",
        },
    }


def main() -> None:
    ensure_dirs()
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    fires = load_fires()
    idx = build_fire_indexes(fires)
    print(f"산불 {len(fires)}건")

    print("시도…")
    sido = process_level(
        "시도", "ctp_rvn", "sido", "CTPRVN_CD", "CTP_KOR_NM", 2.4, idx, True
    )
    for m in sido["markers"]:
        if "전남" in m["name"] and "광주" in m["name"]:
            c = idx[0].get("전남", 0) + idx[0].get("광주", 0)
            m["fire_count"] = c
            apply_prob(m, prob_from_count(c))
    for r in sido["regions"]:
        for m in sido["markers"]:
            if r["code"] == m["code"]:
                r["prob"] = m["prob"]
                r["color"] = m["color"]
                r["fire_count"] = m["fire_count"]
                r["r"] = m["r"]
                r["fill"] = m["color"]
                break

    print("시군구…")
    sig = process_level(
        "시군구", "sig", "sigungu", "SIG_CD", "SIG_KOR_NM", 1.5, idx, True
    )

    print("읍면동…")
    emd = process_level(
        "읍면동", "emd", "emd", "EMD_CD", "EMD_KOR_NM", 0.35, idx, True
    )

    # 하위 평균으로 상위 확률·색상 통일 (줌 시 색감 일치)
    roll_up_from_children(sig["markers"], emd["markers"], lambda x: x["code"][:5])
    roll_up_from_children(sig["regions"], emd["regions"], lambda x: x["code"][:5])
    for r in sig["regions"]:
        for m in sig["markers"]:
            if r["code"] == m["code"]:
                r["prob"] = m["prob"]
                r["color"] = m["color"]
                r["fill"] = m["color"]
                r["r"] = m["r"]
                break

    roll_up_from_children(sido["markers"], sig["markers"], lambda x: x["province"])
    roll_up_from_children(sido["regions"], sig["regions"], lambda x: x["province"])
    for r in sido["regions"]:
        for m in sido["markers"]:
            if r["code"] == m["code"]:
                r["prob"] = m["prob"]
                r["color"] = m["color"]
                r["fill"] = m["color"]
                r["r"] = m["r"]
                break

    (OUT_DIR / "admin-sido.json").write_text(json.dumps(sido, ensure_ascii=False), encoding="utf-8")
    print(f"  {len(sido['regions'])} paths / {len(sido['markers'])} markers")
    (OUT_DIR / "admin-sigungu.json").write_text(json.dumps(sig, ensure_ascii=False), encoding="utf-8")
    print(f"  {len(sig['regions'])} paths / {len(sig['markers'])} markers")
    (OUT_DIR / "admin-emd.json").write_text(json.dumps(emd, ensure_ascii=False), encoding="utf-8")
    print(f"  {len(emd['regions'])} paths / {len(emd['markers'])} markers")

    for name in [
        "admin-sido.json",
        "admin-sigungu.json",
        "admin-emd.json",
    ]:
        p = OUT_DIR / name
        print(f"{name}: {p.stat().st_size / 1e6:.2f} MB")


if __name__ == "__main__":
    main()
