"""산불위험지수 게이지(0~100, 270도 다이얼) 좌표 계산.

frontend/src/lib/choropleth.ts 의 국가산불위험예보 10단계 배색과 동일한 팔레트를 쓴다.
그 팔레트는 리포트 전 구간(게이지·막대·범례)에서 공통으로 재사용한다.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

# 0-10, 10-20, ... 90-100 — choropleth.ts RISK_BAND_COLORS 와 동일 순서
BAND_COLORS: list[str] = [
    "#0D2F6B",
    "#1E5AA8",
    "#0E7C8A",
    "#3DB8E8",
    "#7BCB2E",
    "#C5D94A",
    "#F2E14A",
    "#F5B84A",
    "#F07A1A",
    "#E53935",
]

# WCAG 상대 휘도 기준으로 계산한 밴드별 최적 글자색 (배경 대비 4.5:1 근처 확보)
BAND_TEXT: list[str] = [
    "#ffffff",
    "#ffffff",
    "#ffffff",
    "#16211d",
    "#16211d",
    "#16211d",
    "#16211d",
    "#16211d",
    "#16211d",
    "#16211d",
]

_CX, _CY = 150.0, 150.0
_GAUGE_RADIUS = 118.0
_START_ANGLE = -135.0  # 270도 다이얼(스피드미터 스타일): 왼쪽 위 10시 방향에서 시작
_SWEEP = 270.0


def band_index(score: float) -> int:
    """0~100 점수 → 10단 밴드 인덱스(0~9)."""
    s = max(0.0, min(100.0, float(score or 0)))
    if s >= 100:
        return 9
    return min(9, int(s // 10))


def band_color(score: float) -> str:
    return BAND_COLORS[band_index(score)]


def band_text_color(score: float) -> str:
    return BAND_TEXT[band_index(score)]


def band_range(score: float) -> tuple[int, int]:
    i = band_index(score)
    return i * 10, i * 10 + 10


def _angle_of(value: float) -> float:
    v = max(0.0, min(100.0, float(value or 0)))
    return _START_ANGLE + v / 100.0 * _SWEEP


def _polar(radius: float, angle_deg: float) -> tuple[float, float]:
    a = math.radians(angle_deg - 90.0)
    return (_CX + radius * math.cos(a), _CY + radius * math.sin(a))


def gauge_ring_dot(value: float, radius: float = _GAUGE_RADIUS) -> tuple[float, float]:
    """0~100 값 → 게이지 링 위의 점 좌표 (비교 마커용)."""
    return _polar(radius, _angle_of(value))


def gauge_needle_tip(value: float, length: float = 132.0) -> tuple[float, float]:
    """0~100 값 → 중심에서 뻗어나가는 바늘 끝 좌표."""
    return _polar(length, _angle_of(value))


@dataclass(frozen=True)
class GaugeArc:
    index: int
    lo: int
    hi: int
    color: str
    path: str


def gauge_band_arcs(gap_deg: float = 2.2, radius: float = _GAUGE_RADIUS) -> list[GaugeArc]:
    """10개 밴드의 SVG arc `d` 문자열. 값과 무관한 고정 지오메트리."""
    seg = _SWEEP / 10
    arcs: list[GaugeArc] = []
    for i in range(10):
        start = _START_ANGLE + i * seg + gap_deg / 2
        end = _START_ANGLE + (i + 1) * seg - gap_deg / 2
        sx, sy = _polar(radius, start)
        ex, ey = _polar(radius, end)
        large_arc = 1 if (end - start) > 180 else 0
        d = f"M {sx:.2f} {sy:.2f} A {radius} {radius} 0 {large_arc} 1 {ex:.2f} {ey:.2f}"
        arcs.append(GaugeArc(index=i, lo=i * 10, hi=(i + 1) * 10, color=BAND_COLORS[i], path=d))
    return arcs


def gauge_tick(value: float, radius: float = 148.0) -> tuple[float, float]:
    """0/20/40/60/80/100 눈금 라벨 좌표."""
    return _polar(radius, _angle_of(value))


def gauge_angle(value: float) -> float:
    """0~100 값 → 게이지 각도(도)."""
    return _angle_of(value)


def gauge_xy_at_angle(angle_deg: float, radius: float) -> tuple[float, float]:
    """각도와 반지름 → SVG 좌표."""
    return _polar(radius, angle_deg)
