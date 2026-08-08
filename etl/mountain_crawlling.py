"""
산림청 산정보 서비스 (cultureInfoService2 / mntInfoOpenAPI2).

엔드포인트: https://apis.data.go.kr/1400000/service/cultureInfoService2
조회: /mntInfoOpenAPI2
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path
from xml.etree import ElementTree as ET

import requests
from dotenv import load_dotenv

sys.path.insert(0, str(Path(__file__).resolve().parent))
from paths import KOREA_MOUNTAINS_JSON, ensure_dirs


def _configure_stdout() -> None:
    """Windows 콘솔에서도 UTF-8 JSON이 깨지지 않도록 설정."""
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")


API_BASE = "https://apis.data.go.kr/1400000/service/cultureInfoService2"
API_PATH = "/mntInfoOpenAPI2"
API_URL = API_BASE + API_PATH


def load_service_key() -> str:
    load_dotenv(Path(__file__).resolve().parent.parent / ".env")
    key = os.getenv("FOREST_MOUNTAIN_SERVICE_KEY")
    if not key:
        raise SystemExit(".env에 FOREST_MOUNTAIN_SERVICE_KEY가 없습니다.")
    return key


def fetch_mountain_info(
    service_key: str,
    *,
    search_wrd: str = "",
    page_no: int = 1,
    num_of_rows: int = 10,
) -> requests.Response:
    params = {
        "serviceKey": service_key,
        "searchWrd": search_wrd,
        "pageNo": str(page_no),
        "numOfRows": str(num_of_rows),
    }
    resp = requests.get(API_URL, params=params, timeout=60)
    resp.raise_for_status()
    return resp


def parse_response(xml_text: str) -> tuple[list[dict[str, str]], int]:
    """응답 XML에서 item 목록과 totalCount를 반환."""
    root = ET.fromstring(xml_text)
    result_code = root.findtext(".//resultCode") or ""
    result_msg = root.findtext(".//resultMsg") or ""
    if result_code and result_code != "00":
        raise RuntimeError(f"API 오류: {result_code} {result_msg}")

    total_count = int(root.findtext(".//totalCount") or "0")
    items: list[dict[str, str]] = []
    for item in root.iter("item"):
        row = {child.tag: (child.text or "").strip() for child in item}
        items.append(row)
    return items, total_count


def fetch_all(
    service_key: str,
    *,
    search_wrd: str = "",
    num_of_rows: int = 100,
    sleep_sec: float = 0.15,
) -> tuple[list[dict[str, str]], int]:
    """페이지를 순회하며 전체 산 정보를 수집."""
    first_items, total_count = parse_response(
        fetch_mountain_info(
            service_key,
            search_wrd=search_wrd,
            page_no=1,
            num_of_rows=num_of_rows,
        ).content.decode("utf-8")
    )
    all_items = list(first_items)
    if total_count <= 0:
        return all_items, total_count

    total_pages = (total_count + num_of_rows - 1) // num_of_rows
    print(f"totalCount={total_count}, pages={total_pages}, pageSize={num_of_rows}", flush=True)

    for page in range(2, total_pages + 1):
        time.sleep(sleep_sec)
        items, _ = parse_response(
            fetch_mountain_info(
                service_key,
                search_wrd=search_wrd,
                page_no=page,
                num_of_rows=num_of_rows,
            ).content.decode("utf-8")
        )
        all_items.extend(items)
        print(f"page {page}/{total_pages}: +{len(items)} (collected {len(all_items)})", flush=True)
        if not items:
            break

    return all_items, total_count


def main() -> None:
    _configure_stdout()
    parser = argparse.ArgumentParser(description="산림청 산정보(mntInfoOpenAPI2) 조회")
    parser.add_argument("--searchWrd", default="", help="산 이름 검색어 (비우면 전체)")
    parser.add_argument("--pageNo", type=int, default=1, help="페이지 번호 (--raw 전용)")
    parser.add_argument("--numOfRows", type=int, default=100, help="한 페이지 결과 수")
    parser.add_argument(
        "--out",
        default=str(KOREA_MOUNTAINS_JSON),
        help=f"저장 경로 (기본: {KOREA_MOUNTAINS_JSON})",
    )
    parser.add_argument(
        "--raw",
        action="store_true",
        help="파일 저장 대신 원문 XML을 콘솔에 출력",
    )
    args = parser.parse_args()

    service_key = load_service_key()

    if args.raw:
        resp = fetch_mountain_info(
            service_key,
            search_wrd=args.searchWrd,
            page_no=args.pageNo,
            num_of_rows=args.numOfRows,
        )
        print(resp.content.decode("utf-8"))
        return

    # 기본: 전체 페이지 조회 후 korea_mountains.json 형식으로 저장
    items, total_count = fetch_all(
        service_key,
        search_wrd=args.searchWrd,
        num_of_rows=max(args.numOfRows, 100),
    )
    ensure_dirs()
    out_path = Path(args.out)
    if not out_path.is_absolute():
        out_path = Path(__file__).resolve().parent.parent / out_path
    out_path.parent.mkdir(parents=True, exist_ok=True)
    # load_korea_mountains.py 가 기대하는 원본 item 배열 형식
    out_path.write_text(
        json.dumps(items, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(
        f"saved {len(items)} items (totalCount={total_count}) -> {out_path}",
        flush=True,
    )


if __name__ == "__main__":
    main()
