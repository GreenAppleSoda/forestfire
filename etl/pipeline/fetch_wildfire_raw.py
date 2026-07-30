"""STEP1: 학습용 데이터 — 산림청_산불발생통계 OpenAPI로부터 원본 JSON파일로 저장하는 스크립트

목표
----
산림청 산불발생통계 OpenAPI를 호출해
db-archive/raw/ 아래에 preprocess.py 가 읽을 수 있는 JSON을 만든다.

실행 (프로젝트 루트에서)
----------------------
  python etl/pipeline/fetch_wildfire_raw.py
  python etl/pipeline/fetch_wildfire_raw.py --start 20260601 --end 20260630
  python etl/pipeline/fetch_wildfire_raw.py --start 20110101 --end 20260630 --out wildfire_2011_2026.json

참고 (지우지 않은 기존 코드)
--------------------------
  etl/pipeline/forest_fire_openapi.py  — URL 요청 · XML 파싱 · 페이지네이션
  ml-service/.env                      — FOREST_FIRE_SERVICE_KEY=...

다음 단계
--------
  이 스크립트로 JSON이 생기면 → python etl/pipeline/preprocess.py
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

# etl/ 를 import 경로에 추가 (paths, pipeline.* 사용)
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from paths import DATA_RAW, ensure_dirs

# Option A: 기존 클라이언트는 참고·재사용
from pipeline.forest_fire_openapi import fetch_range, service_key

# preprocess.py 전처리 시 기대하는 한글 컬럼 순서
KOREAN_COLUMNS = [
    "발생일시_년",
    "발생일시_월",
    "발생일시_일",
    "발생일시_시간",
    "발생일시_요일",
    "진화종료시간_년",
    "진화종료시간_월",
    "진화종료시간_일",
    "진화종료시간_시간",
    "발생장소_시도",
    "발생장소_시군구",
    "발생장소_읍면",
    "발생장소_동리",
    "발생장소_번지",
    "발생원인_세부원인",
    "피해면적_합계",
]

# OpenAPI(영문 태그) → 한글 컬럼
# forest_fire_openapi / sync_wildfire_openapi 의 필드명과 동일
FIELD_MAP = {
    "startyear": "발생일시_년",
    "startmonth": "발생일시_월",
    "startday": "발생일시_일",
    "starttime": "발생일시_시간",
    "startdayofweek": "발생일시_요일",
    "endyear": "진화종료시간_년",
    "endmonth": "진화종료시간_월",
    "endday": "진화종료시간_일",
    "endtime": "진화종료시간_시간",
    "locsi": "발생장소_시도",
    "locgungu": "발생장소_시군구",
    "locmenu": "발생장소_읍면",
    "locdong": "발생장소_동리",
    "locbunji": "발생장소_번지",
    "firecause": "발생원인_세부원인",
    "damagearea": "피해면적_합계",
}


def item_en_to_ko(item: dict) -> dict:
    """영문 OpenAPI item 1건 → 한글 키 dict.

    TODO (직접 채워보기):
      1) 빈 dict 만들기
      2) FIELD_MAP 을 돌면서 item.get(영문키, "") 를 한글키로 넣기
      3) KOREAN_COLUMNS 에 없는 키는 넣지 않기 (또는 빈 문자열로 채우기)

    아래는 완성 예시입니다. 지우고 직접 다시 작성해 보세요.
    """
    out: dict[str, str] = {col: "" for col in KOREAN_COLUMNS}
    for en_key, ko_key in FIELD_MAP.items():
        if ko_key in out:
            out[ko_key] = str(item.get(en_key) or "").strip()
    return out


def build_payload(items_en: list[dict]) -> dict:
    """preprocess.py 가 읽는 형식: { count, columns, items }."""
    items_ko = [item_en_to_ko(it) for it in items_en]
    return {
        "count": len(items_ko),
        "columns": list(KOREAN_COLUMNS),
        "items": items_ko,
    }


def save_json(payload: dict, out_path: Path) -> None:
    """JSON 파일로 저장.

    TODO (직접 채워보기):
      out_path.parent.mkdir(parents=True, exist_ok=True)
      out_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    """
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="1단계: OpenAPI → raw wildfire JSON")
    parser.add_argument(
        "--start",
        default="20110101",
        help="시작일 YYYYMMDD (연습은 짧은 기간 권장)",
    )
    parser.add_argument(
        "--end",
        default="20260729",
        help="종료일 YYYYMMDD",
    )
    parser.add_argument(
        "--out",
        default="wildfire_sample.json",
        help="저장 파일명 (DATA_RAW 아래). 전체 dump 시 wildfire_2011_2026.json",
    )
    args = parser.parse_args()

    ensure_dirs()
    out_path = DATA_RAW / args.out

    # --- 여기서부터 실행 흐름을 따라가 보세요 ---
    print("1) 인증키 확인…")
    # TODO: service_key() 호출해 키가 있는지 확인 (없으면 RuntimeError)
    service_key()
    print("   OK")

    print(f"2) OpenAPI fetch {args.start} ~ {args.end} …")
    # TODO: fetch_range(start=..., end=...) 로 items 받기
    #       구현은 forest_fire_openapi.py 참고
    items_en = fetch_range(start=args.start, end=args.end)
    print(f"   받은 건수(영문): {len(items_en)}")

    if items_en:
        print("   샘플 키:", list(items_en[0].keys())[:8], "...")

    print("3) 영문 → 한글 매핑…")
    # TODO: build_payload(items_en) 호출
    payload = build_payload(items_en)
    print(f"   count={payload['count']}")

    print(f"4) 저장 → {out_path}")
    # TODO: save_json(payload, out_path)
    save_json(payload, out_path)
    print("   완료. 다음: python etl/pipeline/preprocess.py")
    print("   (preprocess 는 기본으로 wildfire_2011_2026.json 을 읽습니다.")
    print("    샘플만 만들었으면 --out 이름을 맞추거나 preprocess 입력을 바꾸세요.)")


if __name__ == "__main__":
    main()
