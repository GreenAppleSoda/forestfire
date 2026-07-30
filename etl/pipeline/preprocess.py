"""산불 원본 wildfire_2011_2026.json 파일을 전처리하여 

db-archive/processed/refined_wildfire_data.csv 파일로 저장하는 스크립트

지원 입력:
  - JSON: { count, columns, items: [...] }  (산림청 OpenAPI 형태)
  - CSV: cp949/utf-8-sig
"""

from __future__ import annotations   # type hinting

import sys   # 시스템 경로 추가
from pathlib import Path   # 경로 처리

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import json   # JSON 파일 처리

import pandas as pd   # 데이터 분석

from paths import RAW_WILDFIRE, REFINED_WILDFIRE, ensure_dirs   # 경로 설정
from pipeline.normalize_region_names import format_region_path, normalize_parts   # 지역 정규화


def load_wildfire_raw(file_path: Path) -> pd.DataFrame:   # 원본 데이터 로드
    path = Path(file_path)
    if path.suffix.lower() == ".json":
        raw = json.loads(path.read_text(encoding="utf-8"))   # JSON 파일 읽기
        items = raw.get("items") if isinstance(raw, dict) else raw   # items 배열 추출
        if not isinstance(items, list):
            raise ValueError(f"JSON items 배열이 없습니다: {path}")
        df = pd.DataFrame(items)   # DataFrame 생성
    else:
        for enc in ("cp949", "utf-8-sig", "utf-8"):
            try:
                df = pd.read_csv(path, encoding=enc)
                break
            except UnicodeDecodeError:
                continue
        else:
            raise UnicodeDecodeError("unknown", b"", 0, 1, f"인코딩 실패: {path}")
    return df


def preprocess_wildfire_data(file_path=None):
    ensure_dirs()
    file_path = Path(file_path) if file_path else Path(RAW_WILDFIRE)   # 원본 데이터 경로 : wildfire_2011_2026.json

    df = load_wildfire_raw(file_path)   # 원본 데이터 로드
    print(f"원본: {file_path.name} / {len(df):,}행")

    required = ["발생일시_년", "발생일시_월", "발생일시_일", "발생일시_시간"]   # 필수 컬럼
    for c in required:
        if c not in df.columns:
            raise KeyError(f"필수 컬럼 없음: {c}")

    # cause: 구분이 없으면 세부원인 사용
    if "발생원인_구분" not in df.columns:
        df["발생원인_구분"] = df.get("발생원인_세부원인", "Unknown")
    if "발생장소_읍면" not in df.columns:
        df["발생장소_읍면"] = ""
    if "발생장소_동리" not in df.columns:
        df["발생장소_동리"] = ""
    if "피해면적_합계" not in df.columns:
        df["피해면적_합계"] = 0

    date_parts = df[["발생일시_년", "발생일시_월", "발생일시_일"]].rename(
        columns={"발생일시_년": "year", "발생일시_월": "month", "발생일시_일": "day"}
    )
    df["date"] = pd.to_datetime(date_parts, errors="coerce")

    # HH:MM 또는 HH:MM:SS
    time_str = (
        df["발생일시_시간"]
        .astype(str)
        .str.strip()
        .str.replace(r"^(\d{1,2}:\d{2})(:\d{2})?$", r"\1", regex=True)
    )
    df["datetime"] = pd.to_datetime(
        df["date"].dt.strftime("%Y-%m-%d") + " " + time_str,
        errors="coerce",
    )
    df["hour"] = df["datetime"].dt.hour

    df_refined = df[
        [
            "date",
            "datetime",
            "hour",
            "발생일시_시간",
            "발생장소_시도",
            "발생장소_시군구",
            "발생장소_읍면",
            "발생장소_동리",
            "피해면적_합계",
            "발생원인_구분",
        ]
    ].copy()
    df_refined.columns = [
        "date",
        "datetime",
        "hour",
        "time",
        "province",
        "city",
        "town",
        "village",
        "damage_area",
        "cause",
    ]

    df_refined = df_refined.dropna(subset=["date"]).copy()
    df_refined["damage_area"] = pd.to_numeric(df_refined["damage_area"], errors="coerce").fillna(0)
    df_refined["cause"] = df_refined["cause"].fillna("Unknown")
    for col in ["province", "city", "town", "village", "time"]:
        df_refined[col] = df_refined[col].fillna("Unknown").astype(str).str.strip()
        df_refined.loc[df_refined[col].isin(["", "nan", "None"]), col] = "Unknown"

    def _region_path(row: pd.Series) -> str:
        return format_region_path(
            row.get("province"),
            row.get("city"),
            row.get("town"),
            row.get("village"),
        )

    df_refined["region_path"] = df_refined.apply(_region_path, axis=1)

    # 가능하면 개별 필드도 공식명으로 맞춤 (매칭·표시 일관성)
    lookup_parts = df_refined.apply(
        lambda r: normalize_parts(
            str(r.get("province") or ""),
            str(r.get("city") or ""),
            str(r.get("town") or ""),
            str(r.get("village") or ""),
        ),
        axis=1,
    )
    df_refined["province"] = lookup_parts.map(
        lambda p: p[0] if len(p) > 0 else "Unknown"
    )
    df_refined["city"] = lookup_parts.map(
        lambda p: p[1] if len(p) > 1 else "Unknown"
    )
    df_refined["town"] = lookup_parts.map(
        lambda p: p[2] if len(p) > 2 else "Unknown"
    )
    df_refined["village"] = lookup_parts.map(
        lambda p: p[3] if len(p) > 3 else "Unknown"
    )

    df_refined["is_fire"] = 1
    df_refined = df_refined.sort_values("datetime", ascending=False).reset_index(drop=True)

    print("--- 전처리 샘플 ---")
    print(df_refined.head(3).to_string())
    print(
        f"\n행 수: {len(df_refined):,} | "
        f"기간 {df_refined['date'].min().date()} ~ {df_refined['date'].max().date()} | "
        f"시군구: {df_refined['city'].nunique()} | "
        f"읍면: {df_refined['town'].nunique()}"
    )

    df_refined.to_csv(REFINED_WILDFIRE, index=False, encoding="utf-8")
    print(f"저장: {REFINED_WILDFIRE}")
    return df_refined


if __name__ == "__main__":
    preprocess_wildfire_data()
