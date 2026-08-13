"""
이력 기반 지도용 — 행정구역 SVG 레이어 + 산불 건수 상대 빈도 색.

입력
  - db-archive/raw/geo/          시도·시군구·읍면동 shapefile
  - MariaDB forestfire_stats     산불 이력 (실패 시 refined CSV 폴백)

출력 (frontend/public/data/)
  - admin-sido.json
  - admin-sigungu.json
  - admin-emd.json

프론트 KoreaSvgMap 의 riskMode === "history" 가 이 JSON 의
prob(상대 빈도 0~1) / color / d(경로) 를 사용해 칠합니다.
(ML 분류기 아님 — 같은 행정 레벨 내 과거 건수 비교)
"""

from __future__ import annotations

import sys
from pathlib import Path

# etl/ 를 import 경로에 추가 → paths, pipeline 사용 가능
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import json
import math
import re
from collections import defaultdict

import pandas as pd
import shapefile  # pyshp: .shp 행정경계 읽기
from pyproj import Transformer  # 위도(lat)와 경도(lng)를 TM(한국통합좌표계) 미터 좌표로 변환하는 데 사용

from paths import (
    FRONTEND_PUBLIC_DATA,
    GEO_DIR,
    ensure_dirs,
    sync_backend_data,
)
from pipeline.admin_match import count_city_fires, count_town_fires, strip_admin

OUT_DIR = FRONTEND_PUBLIC_DATA

# ---------------------------------------------------------------------------
# SVG viewBox 좌표계
# shapefile 좌표(EPSG:5179 TM)를 800×900 SVG 픽셀로 옮길 때 쓰는 한반도 bbox (EPSG:5179는 TM 좌표계, 한국통합좌표계의 약칭)
# ---------------------------------------------------------------------------
XMIN, YMIN = 740000.0, 1450000.0   # 한반도 bbox 좌측 하단 좌표 (경도, 위도 순서)
XMAX, YMAX = 1395000.0, 2075000.0   # 한반도 bbox 우측 상단 좌표 (경도, 위도 순서)
WIDTH, HEIGHT = 800, 900   # SVG 픽셀 크기
PAD = 24  # 가장자리 여백(px)

# 위·경도(GPS) → 한국 TM(미터). always_xy=True 이면 (경도, 위도) 순서 (위도, 경도 순서로 변환)
_WGS84_TO_5179 = Transformer.from_crs("EPSG:4326", "EPSG:5179", always_xy=True)

# 시도 라벨 위치 = 시청·도청 (WGS84 lat, lng) (위도, 경도 순서)
# 폴리곤 bbox 중심을 쓰면 섬·바다 쪽으로 라벨이 밀리는 경우가 많아서 고정 좌표 사용 (위도, 경도 순서)
SIDO_OFFICE_WGS84: dict[str, tuple[float, float]] = {
    "서울": (37.5665, 126.9780),  # 서울특별시청
    "부산": (35.1796, 129.0756),  # 부산광역시청
    "대구": (35.8714, 128.6014),  # 대구광역시청
    "인천": (37.4563, 126.7052),  # 인천광역시청
    "광주": (35.1595, 126.8526),  # 광주광역시청
    "대전": (36.3504, 127.3845),  # 대전광역시청
    "울산": (35.5384, 129.3114),  # 울산광역시청
    "세종": (36.4801, 127.2890),  # 세종특별자치시청
    "경기": (37.2751, 127.0095),  # 경기도청(수원)
    "강원": (37.8854, 127.7298),  # 강원특별자치도청(춘천)
    "충북": (36.6357, 127.4912),  # 충청북도청(청주)
    "충남": (36.6597, 126.6728),  # 충청남도청(홍성 내포)
    "전북": (35.8203, 127.1088),  # 전북특별자치도청(전주)
    "전남": (35.1595, 126.8526),  # 통합 폴리곤 → 광주광역시청(육지 중앙)
    "경북": (36.5760, 128.5056),  # 경상북도청(안동)
    "경남": (35.2279, 128.6819),  # 경상남도청(창원)
    "제주": (33.4890, 126.4983),  # 제주특별자치도청
}

# 법정동 코드 앞 2자리 → 시도 약칭 (통계청 행정구역 코드)
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
# 코드 prefix "12" 는 광주·전남이 섞여 있어 시군구 5자리로 구분
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
PROV_FULL_TO_SHORT = {v: k for k, v in PROV_FULL.items()}
# DB/지도에 남는 통합·구표기 → 시군구 매칭용 약칭
PROV_ALIAS_TO_SHORT = {
    "전남광주통합특별시": "전남",
    "전라북도": "전북",
    "강원도": "강원",
}

# ---------------------------------------------------------------------------
# 좌표 변환 · 이름 정규화 · 폴리곤 → SVG path
# ---------------------------------------------------------------------------

def to_svg(x: float, y: float) -> tuple[float, float]:
    """TM 미터 좌표 → SVG (x, y). Y는 화면 좌표계라 위아래 뒤집음."""
    sx = PAD + (x - XMIN) / (XMAX - XMIN) * (WIDTH - 2 * PAD)
    sy = PAD + (YMAX - y) / (YMAX - YMIN) * (HEIGHT - 2 * PAD)
    return round(sx, 2), round(sy, 2)


def wgs84_to_svg(lat: float, lng: float) -> tuple[float, float]:
    """GPS(위·경도) → SVG 픽셀."""
    tm_x, tm_y = _WGS84_TO_5179.transform(lng, lat)
    return to_svg(tm_x, tm_y)


def label_point_tm(shape, level: str, prov: str) -> tuple[float, float]:
    """지도 위 이름/마커 위치. 시도는 도청, 그 외는 가장 큰 육지 링 중심."""
    if level == "sido":
        ll = SIDO_OFFICE_WGS84.get(prov)
        if ll:
            return wgs84_to_svg(ll[0], ll[1])
    return to_svg(*centroid_tm(shape))


def normalize_province(name: str) -> str:
    """공식명/약칭/접미 혼합 표기를 시도 약칭(서울, 강원...)으로 통일."""
    raw = str(name or "").strip()
    if not raw or raw == "Unknown":
        return ""
    if raw in PROV_FULL:
        return raw
    if raw in PROV_FULL_TO_SHORT:
        return PROV_FULL_TO_SHORT[raw]
    if raw in PROV_ALIAS_TO_SHORT:
        return PROV_ALIAS_TO_SHORT[raw]
    compact = re.sub(r"\s+", "", raw)
    if compact in PROV_ALIAS_TO_SHORT:
        return PROV_ALIAS_TO_SHORT[compact]
    # 전남·광주 통합 표기 (DB/구 shapefile)
    if "전남광주" in compact:
        return "전남"
    short = strip_admin(raw)
    if short in PROV_FULL:
        return short
    # 예: "강원특별자치도청", "경상북도(임시)" 같이 접미가 더 붙은 경우 대응
    for k, full in PROV_FULL.items():
        if raw.startswith(full) or full in raw:
            return k
    return ""


def simplify_ring(points: list[tuple[float, float]], tol: float) -> list[tuple[float, float]]:
    """Douglas–Peucker: 점 수를 줄여 JSON 용량·렌더 부담을 낮춤."""
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
        out.append(out[0])  # 닫힌 링
    return out


def path_tolerance(shape, level: str, base_tol: float) -> float:
    """작은 읍면동은 덜 단순화(구멍·깨짐 방지), 큰 구역은 base_tol 사용.

    base_tol 은 SVG viewBox(800×900) 단위. 값이 작을수록 경계가 조밀해진다.
    """
    if level != "emd":
        return base_tol
    b = shape.bbox
    extent = max(b[2] - b[0], b[3] - b[1])
    if extent >= 20000:
        return max(base_tol, 0.18)
    if extent >= 8000:
        return max(base_tol * 0.7, 0.12)
    return max(base_tol * 0.45, 0.06)


def shape_to_svg_path(shape, tol: float) -> str | None:
    """shapefile 폴리곤 → SVG path 문자열 (M/L/Z). 프론트의 d 속성에 들어감."""
    pts = shape.points
    parts = list(shape.parts) + [len(pts)]  # 멀티폴리곤/홀 경계 인덱스
    cmds: list[str] = []
    for i in range(len(parts) - 1):
        ring = [to_svg(x, y) for x, y in pts[parts[i] : parts[i + 1]]]
        if len(ring) < 4:
            continue
        ring = simplify_ring(ring, tol)
        if len(ring) < 4:
            continue
        # 소수 2자리: 용량과 경계 정밀도 균형 (1자리는 들쭉날쭉 유발)
        x0, y0 = ring[0]
        cmds.append(f"M{x0:.2f},{y0:.2f}")
        for x, y in ring[1:]:
            cmds.append(f"L{x:.2f},{y:.2f}")
        cmds.append("Z")
    return "".join(cmds) if cmds else None


def _ring_area(pts: list[tuple[float, float]]) -> float:
    a = 0.0
    for i in range(len(pts) - 1):
        x1, y1 = pts[i]
        x2, y2 = pts[i + 1]
        a += x1 * y2 - x2 * y1
    return a * 0.5


def _ring_centroid(pts: list[tuple[float, float]]) -> tuple[float, float]:
    a = 0.0
    cx = 0.0
    cy = 0.0
    for i in range(len(pts) - 1):
        x1, y1 = pts[i]
        x2, y2 = pts[i + 1]
        cross = x1 * y2 - x2 * y1
        a += cross
        cx += (x1 + x2) * cross
        cy += (y1 + y2) * cross
    if abs(a) < 1e-9:
        n = max(len(pts) - 1, 1)
        return (
            sum(p[0] for p in pts[:-1]) / n,
            sum(p[1] for p in pts[:-1]) / n,
        )
    return cx / (3.0 * a), cy / (3.0 * a)


def _point_in_ring(x: float, y: float, ring: list[tuple[float, float]]) -> bool:
    inside = False
    j = len(ring) - 1
    for i, (xi, yi) in enumerate(ring):
        xj, yj = ring[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / ((yj - yi) or 1e-12) + xi:
            inside = not inside
        j = i
    return inside


def centroid_tm(shape) -> tuple[float, float]:
    """가장 큰 링의 면적 중심. bbox 중심은 섬·좁은 돌출부에 라벨이 밀림."""
    pts = shape.points
    parts = list(shape.parts) + [len(pts)]
    best_ring = None
    best_area = -1.0
    for i in range(len(parts) - 1):
        ring = pts[parts[i] : parts[i + 1]]
        if len(ring) < 4:
            continue
        a = abs(_ring_area(ring))
        if a > best_area:
            best_area = a
            best_ring = ring
    if not best_ring:
        b = shape.bbox
        return (b[0] + b[2]) / 2, (b[1] + b[3]) / 2
    cx, cy = _ring_centroid(best_ring)
    if _point_in_ring(cx, cy, best_ring):
        return cx, cy
    xs = [p[0] for p in best_ring]
    ys = [p[1] for p in best_ring]
    return (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2


def resolve_province_from_code(code: str) -> str:
    """행정코드 → 시도 약칭. '12' 는 광주/전남 특수 처리."""
    pref = code[:2]
    if pref != "12":
        return PREFIX_TO_PROV.get(pref, "")
    sig5 = code[:5] if len(code) >= 5 else code
    return "광주" if sig5 in GWANGJU_SIG else "전남"


# ---------------------------------------------------------------------------
# 이력 빈도 · 색상 (ML 아님 — 같은 레벨 내 과거 건수 상대 비교)
# ---------------------------------------------------------------------------

def intensity_from_count(count: int, max_count: int) -> float:
    """fire_count / 해당 레벨 max → 0~1 상대 빈도."""
    if max_count <= 0 or count <= 0:
        return 0.0
    return round(min(1.0, float(count) / float(max_count)), 4)


def _hsl_to_rgb(h: float, s: float, l: float) -> tuple[int, int, int]:
    """HSL → RGB (지도 색 그라데이션용)."""
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


# (상대빈도 t, Hue, Saturation, Lightness) — 낮음(초록) → 높음(주황)
_RISK_STOPS = [
    (0.0, 142, 55, 38),
    (0.28, 98, 52, 46),
    (0.55, 55, 78, 50),
    (0.78, 36, 90, 50),
    (1.0, 24, 92, 48),
]


def intensity_color(intensity: float) -> str:
    """상대 빈도(0~1) → #RRGGBB. 전 구간 선형 보간."""
    t = max(0.0, min(1.0, intensity))
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


def apply_intensity(item: dict, intensity: float) -> None:
    """지역 dict 에 상대빈도(prob 필드)·color·마커 반지름 r 을 in-place 로 채움.

    하위 호환: JSON 필드명은 기존 `prob` 유지하되, 값은 1년 확률이 아니라
    같은 행정 레벨 내 fire_count 상대 밀도(0~1)이다.
    """
    item["prob"] = intensity
    item["color"] = intensity_color(intensity)
    item["r"] = round(3.2 + 7.5 * (intensity**0.85), 2)


def recolor_regions_by_fire_count(regions: list[dict]) -> int:
    """레벨 내 max fire_count 기준으로 상대 빈도·색 재계산. max 반환."""
    mx = int(max((int(r.get("fire_count") or 0) for r in regions), default=0))
    for r in regions:
        apply_intensity(r, intensity_from_count(int(r.get("fire_count") or 0), mx))
    return mx


# 하위 호환 별칭 (refresh_history_layers 등)
def apply_prob(item: dict, intensity: float) -> None:
    apply_intensity(item, intensity)


def prob_from_count(count: int, max_count: int = 0) -> float:
    """하위 호환. max_count 없으면 단일 건수로는 의미 없으므로 0."""
    return intensity_from_count(count, max_count)


def roll_up_from_children(
    parents: list[dict], children: list[dict], key_fn
) -> None:
    """하위 호환 no-op. 이력 색은 레벨별 fire_count 상대 비교만 사용."""
    return


# ---------------------------------------------------------------------------
# 산불 CSV → 집계 인덱스 (시도 / 시군구 / 읍면 / 동리)
# ---------------------------------------------------------------------------

def load_fires(df: pd.DataFrame | None = None) -> pd.DataFrame:
    """산불 이력 로드. province 없는 행은 제외.

    df 를 넘기면 그 프레임을 쓰고, 없으면 MariaDB → refined CSV 순으로 로드.
    """
    if df is None:
        from pipeline.load_wildfire_history import load_wildfire_history_raw

        df = load_wildfire_history_raw()
    else:
        df = df.copy()
    for c in ["province", "city", "town", "village"]:
        if c not in df.columns:
            df[c] = ""
        df[c] = df[c].fillna("").astype(str).str.strip()
    # DB 공식명(예: 강원특별자치도, 전남광주통합특별시) → 지도 약칭(강원, 전남)
    df["province"] = df["province"].map(normalize_province)
    return df[df["province"].ne("")].copy()


def build_fire_indexes(fires: pd.DataFrame):
    """
    빠른 조인을 위해 건수를 미리 센 딕셔너리 4개 반환.
    키 예: by_city["강원|영월"] = 42
           by_town_name["경기|양주|장흥면"] = 8  (시군구+읍면동 접미사 포함)
    """
    by_prov = fires.groupby("province").size().to_dict()
    by_city: dict[str, int] = defaultdict(int)
    by_town_name: dict[str, int] = defaultdict(int)
    by_village_name: dict[str, int] = defaultdict(int)

    for _, r in fires.iterrows():
        p, c, t, v = r["province"], r["city"], r["town"], r["village"]
        by_city[f"{p}|{strip_admin(c)}"] += 1
        if t and t != "Unknown":
            by_town_name[f"{p}|{strip_admin(c)}|{t}"] += 1
        if v and v != "Unknown":
            by_village_name[f"{p}|{strip_admin(c)}|{strip_admin(t)}|{v}"] += 1

    return by_prov, by_city, by_town_name, by_village_name


# ---------------------------------------------------------------------------
# 레벨별 shapefile 처리 → admin-*.json 한 덩어리
# ---------------------------------------------------------------------------

def process_level(
    folder: str,
    shp_name: str,
    level: str,
    code_field: str,
    name_field: str,
    tol: float,
    fires_idx,
    include_paths: bool,
    parent_names: dict[str, str] | None = None,
) -> dict:
    """
    GEO_DIR/{folder}/{shp_name}.shp 를 읽어 regions[] 를 만든다.

    각 region:
      code, name, province, fire_count, prob, color, x/y, r, d(SVG path), label
    """
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

        # 시도 레이어: shapefile 한글명으로 약칭 보정 (광주·전남 통합 폴리곤 등)
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

        sx, sy = label_point_tm(shape, level, prov)
        n = strip_admin(name)

        # 산불 건수 매칭 (레벨마다 인덱스 키가 다름)
        count = 0
        if level == "sido":
            count = int(by_prov.get(prov, 0))
        elif level == "sigungu":
            count = count_city_fires(by_city, prov, name)
        elif level == "emd":
            prov = resolve_province_from_code(code[:5] if len(code) >= 5 else code) or prov
            parent = ""
            if parent_names:
                parent = parent_names.get(code[:5], "") if len(code) >= 5 else ""
            count = count_town_fires(by_town_name, prov, parent, name)
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

    # path 가 있는 것만 프론트에 전달 (색은 아래에서 레벨 max 기준 상대 빈도)
    regions = []
    for r in rows:
        if not (include_paths and r["d"]):
            continue
        regions.append(
            {
                "code": r["code"],
                "name": r["name"],
                "province": r["province"],
                "province_name": r["province_name"],
                "fire_count": r["fire_count"],
                "prob": 0.0,
                "color": intensity_color(0.0),
                "x": r["x"],
                "y": r["y"],
                "r": 3.2,
                "d": r["d"],
                "label": [r["x"], r["y"]],
            }
        )

    mx = recolor_regions_by_fire_count(regions)
    return {
        "level": level,
        "viewBox": [WIDTH, HEIGHT],
        "regions": regions,
        # 예전 markers 배열은 regions 와 중복이라 비움 (용량 절약)
        "markers": [],
        "meta": {
            "n_regions": len(regions),
            "n_markers": 0,
            "max_fire_count": mx,
            "prob_note": "과거 산불 발생 건수 상대 빈도(같은 행정 레벨 내 비교)",
        },
    }


def main() -> None:
    """시도 → 시군구 → 읍면동 순으로 만들고, 레벨별 건수 상대 빈도로 색을 입혀 저장."""
    ensure_dirs()
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    fires = load_fires()
    idx = build_fire_indexes(fires)
    print(f"산불 {len(fires)}건")

    print("시도…")
    sido = process_level(
        "시도", "ctp_rvn", "sido", "CTPRVN_CD", "CTP_KOR_NM", 0.45, idx, True
    )
    # 광주·전남이 한 폴리곤인 경우 건수를 합산 후 상대 빈도 재계산
    for r in sido["regions"]:
        if "전남" in r["name"] and "광주" in r["name"]:
            c = idx[0].get("전남", 0) + idx[0].get("광주", 0)
            r["fire_count"] = c
    sido["meta"]["max_fire_count"] = recolor_regions_by_fire_count(sido["regions"])

    print("시군구…")
    sig = process_level(
        "시군구", "sig", "sigungu", "SIG_CD", "SIG_KOR_NM", 0.32, idx, True
    )
    sig_names = {r["code"]: r["name"] for r in sig["regions"]}

    print("읍면동…")
    emd = process_level(
        "읍면동",
        "emd",
        "emd",
        "EMD_CD",
        "EMD_KOR_NM",
        0.12,
        idx,
        True,
        parent_names=sig_names,
    )

    # separators 로 공백 제거 → 파일 크기 축소
    dumps_kw = {"ensure_ascii": False, "separators": (",", ":")}
    (OUT_DIR / "admin-sido.json").write_text(json.dumps(sido, **dumps_kw), encoding="utf-8")
    print(f"  {len(sido['regions'])} paths")
    (OUT_DIR / "admin-sigungu.json").write_text(json.dumps(sig, **dumps_kw), encoding="utf-8")
    print(f"  {len(sig['regions'])} paths")
    (OUT_DIR / "admin-emd.json").write_text(json.dumps(emd, **dumps_kw), encoding="utf-8")
    print(f"  {len(emd['regions'])} paths")

    for name in [
        "admin-sido.json",
        "admin-sigungu.json",
        "admin-emd.json",
    ]:
        p = OUT_DIR / name
        print(f"{name}: {p.stat().st_size / 1e6:.2f} MB")

    sync_backend_data()


if __name__ == "__main__":
    main()
