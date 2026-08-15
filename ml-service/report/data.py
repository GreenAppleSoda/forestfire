"""daily_ml_risk payload → 리포트 템플릿 컨텍스트.

수치 계산과 한국어 문장 생성을 이 파일에 모아 둔다. 템플릿(.html.j2)은
여기서 만든 값을 그대로 찍기만 하면 되도록 최대한 "멍청하게" 유지한다.
챗봇 쪽에서 narrative 문장만 따로 재사용(TTS·답변 텍스트)해도 되도록
컨텍스트에 narrative 딕셔너리를 별도로 둔다.
"""

from __future__ import annotations

import json
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path

from ml_paths import DAILY_ML_RISK
from report.geometry import (
    band_color,
    band_range,
    band_text_color,
    gauge_band_arcs,
    gauge_needle_tip,
    gauge_ring_dot,
    gauge_tick,
)

_WEEKDAY_KR = ["월", "화", "수", "목", "금", "토", "일"]


def _has_batchim(word: str) -> bool:
    """단어 끝 글자에 받침이 있는지(한글 완성형 기준)."""
    if not word:
        return False
    code = ord(word[-1]) - 0xAC00
    if 0 <= code < 11172:
        return code % 28 != 0
    return False  # 한글이 아니면(숫자·영문 등) 받침 없는 것으로 취급


def josa(word: str, pair: str) -> str:
    """받침 유무에 따른 조사 선택. pair는 '이가'/'은는'/'을를'처럼 받침있음+받침없음 순."""
    return pair[0] if _has_batchim(word) else pair[1]


NATIONAL_SCOPE = "전국"
_NATIONAL_ALIASES = {"전국", "전체", "전국구", "대한민국", "전 지역", "전지역"}


def load_payload(path: str | Path | None = None) -> dict:
    """daily_ml_risk.json 로드. 경로 미지정 시 ml_paths.DAILY_ML_RISK.

    실시간 예측을 쓰고 싶으면 이 함수 대신
    predict.daily.run_daily_predict(write_file=False)의 반환값을 그대로 넘기면 된다.
    """
    p = Path(path) if path else DAILY_ML_RISK
    if not p.exists():
        raise FileNotFoundError(f"{p} 없음. ml-service에서 predict.daily 먼저 실행하세요.")
    return json.loads(p.read_text(encoding="utf-8"))


def risk_index(ml_risk: float) -> float:
    """ml_risk(0~1 확률) → 산불위험지수(0~100, 소수 1자리)."""
    return round(float(ml_risk or 0) * 1000) / 10


def weekday_kr(date_str: str) -> str:
    y, m, d = (int(x) for x in date_str.split("-")[:3])
    return _WEEKDAY_KR[date(y, m, d).weekday()]


def describe_weather(temp: float, humidity: float, wind: float, precip: float) -> str:
    """기온·습도·풍속·강수 조합을 짧은 한국어 한 문장으로 요약."""
    if precip and precip > 0:
        parts = [f"강수 {precip:.1f}mm가 있어 습윤한 편이고"]
    else:
        parts = ["강수 없이 건조한 편이고"]

    if humidity < 40:
        parts.append("습도도 매우 낮습니다.")
    elif humidity < 55:
        parts.append("습도는 다소 낮은 편입니다.")
    else:
        parts.append("습도는 무난한 편입니다.")

    if wind >= 5:
        parts.append("바람이 강해 확산 위험을 키울 수 있는 조건입니다.")
    elif wind >= 3:
        parts.append("바람이 다소 있어 주의가 필요합니다.")
    else:
        parts.append("바람은 약한 편입니다.")

    return " ".join(parts)


@dataclass(frozen=True)
class ResolvedTarget:
    province: str
    highlight_name: str | None  # 사용자가 특정 시군구를 콕 집어 물었을 때만 값이 있음

    @property
    def title_label(self) -> str:
        return f"{self.province} {self.highlight_name}" if self.highlight_name else self.province


def resolve_target(regions: list[dict], query: str) -> ResolvedTarget:
    """사용자가 말한 지역 문자열 → (시·도, 강조할 시군구).

    지원하는 입력 형태:
      - 시·도명 그대로: "서울", "경기"
      - 시군구명 단독: "노원구" (전국에 유일하면 해당 시·도로 자동 해석)
      - "시·도 시군구": "부산 중구" (동명 시군구가 여러 시·도에 있을 때 명시적으로 구분)
      - 전국(또는 "전체"/"대한민국" 등): 특정 지역을 못 찾았거나 챗봇이 지역을
        특정하지 못했을 때의 기본값 — 전국 종합 리포트
    """
    q = " ".join(query.strip().split())
    if not q or q in _NATIONAL_ALIASES:
        return ResolvedTarget(province=NATIONAL_SCOPE, highlight_name=None)

    provinces = sorted({r["province"] for r in regions})
    if q in provinces:
        return ResolvedTarget(province=q, highlight_name=None)

    if " " in q:
        prov_part, name_part = q.rsplit(" ", 1)
        if prov_part in provinces:
            match = next(
                (r for r in regions if r["province"] == prov_part and r["name"] == name_part),
                None,
            )
            if match:
                return ResolvedTarget(province=prov_part, highlight_name=match["name"])

    exact = [r for r in regions if r["name"] == q]
    if len(exact) == 1:
        return ResolvedTarget(province=exact[0]["province"], highlight_name=exact[0]["name"])
    if len(exact) > 1:
        provs = sorted({r["province"] for r in exact})
        raise ValueError(
            f"'{q}'가 여러 시·도에 있습니다 ({', '.join(provs)}). '{provs[0]} {q}'처럼 시·도를 붙여 주세요."
        )

    partial = [r for r in regions if q in r["name"]]
    names = sorted({r["name"] for r in partial})
    if len(names) == 1:
        matches = [r for r in partial if r["name"] == names[0]]
        if len(matches) == 1:
            return ResolvedTarget(province=matches[0]["province"], highlight_name=matches[0]["name"])
        provs = sorted({r["province"] for r in matches})
        raise ValueError(
            f"'{names[0]}'가 여러 시·도에 있습니다 ({', '.join(provs)}). "
            f"'{provs[0]} {names[0]}'처럼 시·도를 붙여 주세요."
        )

    raise ValueError(f"'{q}'에 해당하는 시·도/시군구를 찾을 수 없습니다.")


def _compare_marks(
    self_name: str, self_val: float, province: str, province_val: float, national_val: float
) -> list[dict]:
    """지역 상세 카드의 미니 비교축 마커. 값이 가까우면(0-100 스케일에서 8p 이내)
    라벨이 겹치므로 뒤쪽(자기 자신 우선) 것을 건너뛴다."""
    candidates = [
        (self_val, f"{self_name} {self_val:.1f}", True),
        (province_val, f"{province} {province_val:.1f}", False),
        (national_val, f"전국 {national_val:.1f}", False),
    ]
    kept: list[dict] = []
    for value, label, is_self in candidates:
        if any(abs(value - k["value"]) < 8 for k in kept):
            continue
        kept.append({"value": value, "label": label, "is_self": is_self})
    return kept


def _rank_with_ties(rows_sorted_desc: list[dict], value_key: str) -> list[int]:
    ranks: list[int] = []
    rank = 0
    prev = object()
    for i, row in enumerate(rows_sorted_desc):
        v = row[value_key]
        if v != prev:
            rank = i + 1
            prev = v
        ranks.append(rank)
    return ranks


def build_context(payload: dict, query: str, generated_at: datetime | None = None) -> dict:
    regions = payload.get("regions") or []
    if not regions:
        raise ValueError("payload.regions 가 비어 있습니다.")

    target = resolve_target(regions, query)
    province = target.province
    is_national = province == NATIONAL_SCOPE

    all_idx = [risk_index(r["ml_risk"]) for r in regions]
    national_avg = round(sum(all_idx) / len(all_idx), 1)
    national_min = min(all_idx)
    national_max = max(all_idx)
    national_max_region = max(regions, key=lambda r: r["ml_risk"])

    if is_national:
        prov_rows = sorted(regions, key=lambda r: -r["ml_risk"])
    else:
        prov_rows = sorted(
            [r for r in regions if r["province"] == province], key=lambda r: -r["ml_risk"]
        )
    if not prov_rows:
        raise ValueError(f"'{province}' 데이터가 없습니다.")

    ranking = [
        {"name": r["name"], "idx": risk_index(r["ml_risk"])} for r in prov_rows
    ]
    ranks = _rank_with_ties(ranking, "idx")
    for row, rk in zip(ranking, ranks):
        row["rank"] = rk
        row["is_top"] = rk == 1
        row["is_highlight"] = target.highlight_name is not None and row["name"] == target.highlight_name
        row["color"] = band_color(row["idx"])
        row["text_color"] = band_text_color(row["idx"])
        row["width_pct"] = max(1.5, row["idx"])
        row["band_lo"], row["band_hi"] = band_range(row["idx"])

    idxs = [row["idx"] for row in ranking]
    prov_avg = round(sum(idxs) / len(idxs), 1)
    prov_min = min(idxs)
    prov_max = max(idxs)

    band_legend = sorted(
        {(band_range(v)[0], band_range(v)[1], band_color(v)) for v in idxs}, reverse=True
    )

    top_group = [row for row in ranking if row["rank"] == 1]
    spotlight = list(top_group)
    if target.highlight_name and not any(row["name"] == target.highlight_name for row in spotlight):
        hl = next((row for row in ranking if row["name"] == target.highlight_name), None)
        if hl:
            spotlight.append(hl)
    spotlight = spotlight[:4]
    for row in spotlight:
        row["marks"] = _compare_marks(row["name"], row["idx"], province, prov_avg, national_avg)

    buckets: dict[str, list[float]] = defaultdict(list)
    for r in regions:
        buckets[r["province"]].append(risk_index(r["ml_risk"]))
    prov_table = [
        {"name": name, "avg": round(sum(vals) / len(vals), 1), "n": len(vals)}
        for name, vals in buckets.items()
    ]
    prov_table.sort(key=lambda x: -x["avg"])
    prov_ranks = _rank_with_ties(prov_table, "avg")
    for row, rk in zip(prov_table, prov_ranks):
        row["rank"] = rk
        row["color"] = band_color(row["avg"])
        row["text_color"] = band_text_color(row["avg"])
        row["is_target"] = row["name"] == province
        row["width_pct"] = max(1.5, row["avg"])
    province_rank = (
        None if is_national else next(row["rank"] for row in prov_table if row["name"] == province)
    )
    province_count = len(prov_table)

    temps = [r["temp_avg"] for r in prov_rows]
    hums = [r["humidity_avg"] for r in prov_rows]
    winds = [r["wind_avg"] for r in prov_rows]
    precs = [r["precip"] for r in prov_rows]
    weather_keys = {(r["temp_avg"], r["humidity_avg"], r["wind_avg"], r["precip"]) for r in prov_rows}
    weather = {
        "uniform": len(weather_keys) == 1,
        "temp_avg": round(sum(temps) / len(temps), 1),
        "temp_min": min(temps),
        "temp_max": max(temps),
        "humidity_avg": round(sum(hums) / len(hums), 1),
        "humidity_min": min(hums),
        "humidity_max": max(hums),
        "wind_avg": round(sum(winds) / len(winds), 1),
        "wind_min": min(winds),
        "wind_max": max(winds),
        "precip_avg": round(sum(precs) / len(precs), 1),
        "precip_max": max(precs),
    }

    diff = round(prov_avg - national_avg, 1)
    cmp_phrase = (
        f"전국 평균보다 {diff:.1f}포인트 높습니다" if diff >= 0 else f"전국 평균보다 {abs(diff):.1f}포인트 낮습니다"
    )
    range_phrase = (
        f"모두 {prov_min:.1f}로 동일합니다" if prov_min == prov_max else f"{prov_min:.1f} ~ {prov_max:.1f} 사이입니다"
    )
    top_names = [row["name"] for row in top_group]
    if len(top_names) == 1:
        rank_summary = f"{top_names[0]}{josa(top_names[0], '이가')} 지수 {prov_max:.1f}로 가장 높습니다."
    else:
        names_joined = "·".join(top_names)
        rank_summary = f"{names_joined}{josa(names_joined, '이가')} 지수 {prov_max:.1f}로 공동 1위입니다."
    if weather["uniform"]:
        weather_note = (
            f"{province}{josa(province, '은는')} 단일 대표 관측지점 값이 모든 하위 지역에 동일하게 적용됩니다. "
            "따라서 지역 간 위험도 차이는 기상이 아닌 과거 이력·건조지수 등 비기상 요인에서 비롯됩니다."
        )
    else:
        weather_note = (
            f"{province} 내에서도 지역별 관측값에 차이가 있어 "
            f"기온 {weather['temp_min']:.1f}~{weather['temp_max']:.1f}℃, "
            f"습도 {weather['humidity_min']:.0f}~{weather['humidity_max']:.0f}%, "
            f"풍속 {weather['wind_min']:.1f}~{weather['wind_max']:.1f}m/s 범위를 보입니다."
        )

    if is_national:
        cover_sentence = (
            f"전국 {len(prov_rows)}개 지역의 산불위험지수는 {range_phrase}. "
            f"전국 평균은 {prov_avg:.1f}입니다."
        )
    else:
        cover_sentence = (
            f"{province} {len(prov_rows)}개 지역의 산불위험지수는 {range_phrase}. "
            f"{province} 평균({prov_avg:.1f})은 {cmp_phrase} "
            f"(전국 {province_count}개 시·도 중 {province_rank}위)."
        )

    narrative = {
        "cover": cover_sentence,
        "rank_summary": rank_summary,
        "weather_note": weather_note,
        "weather_desc": describe_weather(
            weather["temp_avg"], weather["humidity_avg"], weather["wind_avg"], weather["precip_avg"]
        ),
    }

    needle_x, needle_y = gauge_needle_tip(prov_avg)
    dot_natavg_x, dot_natavg_y = gauge_ring_dot(national_avg)
    dot_provmin_x, dot_provmin_y = gauge_ring_dot(prov_min)
    dot_provmax_x, dot_provmax_y = gauge_ring_dot(prov_max)
    ticks = [{"v": v, "x": round(x, 1), "y": round(y, 1)} for v in (0, 20, 40, 60, 80, 100) for x, y in [gauge_tick(v)]]

    predict_date = payload.get("predict_date") or ""
    metrics = payload.get("model_metrics") or {}
    prov_band_lo, prov_band_hi = band_range(prov_avg)

    return {
        "title_label": target.title_label,
        "province": province,
        "province_eun_neun": josa(province, "은는"),
        "is_national": is_national,
        "highlight_name": target.highlight_name,
        "predict_date": predict_date,
        "weekday": weekday_kr(predict_date) if predict_date else "",
        "observed_at": payload.get("observed_at") or "",
        "weather_source": payload.get("weather_source") or "",
        "generated_at": (generated_at or datetime.now()).strftime("%Y-%m-%d %H:%M"),
        "n_regions": len(prov_rows),
        "national": {
            "avg": national_avg,
            "min": national_min,
            "max": national_max,
            "max_name": national_max_region.get("name"),
            "max_province": national_max_region.get("province"),
            "count": len(regions),
        },
        "province_stat": {
            "avg": prov_avg,
            "min": prov_min,
            "max": prov_max,
            "band_color": band_color(prov_avg),
            "band_text": band_text_color(prov_avg),
            "band_lo": prov_band_lo,
            "band_hi": prov_band_hi,
            "rank": province_rank,
            "count": province_count,
            "top_group_size": len(top_group),
        },
        "ranking": ranking,
        "band_legend": [{"lo": lo, "hi": hi, "color": color} for lo, hi, color in band_legend],
        "spotlight": spotlight,
        "province_table": prov_table,
        "weather": weather,
        "gauge": {
            "arcs": gauge_band_arcs(),
            "ticks": ticks,
            "needle": {"x": round(needle_x, 2), "y": round(needle_y, 2)},
            "dots": {
                "national_avg": {"x": round(dot_natavg_x, 2), "y": round(dot_natavg_y, 2)},
                "province_min": {"x": round(dot_provmin_x, 2), "y": round(dot_provmin_y, 2)},
                "province_max": {"x": round(dot_provmax_x, 2), "y": round(dot_provmax_y, 2)},
            },
        },
        "metrics": {
            "roc_auc": metrics.get("roc_auc"),
            "pr_auc": metrics.get("pr_auc"),
            "threshold": metrics.get("threshold"),
            "base_rate_test": metrics.get("base_rate_test"),
        },
        "note": payload.get("note") or "",
        "narrative": narrative,
    }
