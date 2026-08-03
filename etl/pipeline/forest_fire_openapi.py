"""산림청 산불발생통계 OpenAPI (data.go.kr) 클라이언트.

엔드포인트:
  https://apis.data.go.kr/1400000/forestStusService/getfirestatsservice

환경변수 (우선순위):
  FOREST_FIRE_SERVICE_KEY > DATA_GO_KR_SERVICE_KEY > SERVICE_KEY
"""

from __future__ import annotations

import os
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

from paths import ML_SERVICE_ENV, FRONTEND_ENV_LOCAL

API_URL = (
    "https://apis.data.go.kr/1400000/forestStusService/getfirestatsservice"
)
REQUEST_TIMEOUT_SEC = 30
MAX_RETRIES = 3


def _read_env_key(env_path: Path, names: tuple[str, ...]) -> str:
    if not env_path.exists():
        return ""
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        if k.strip() in names:
            return v.strip().strip('"').strip("'")
    return ""


def service_key() -> str:
    for name in ("FOREST_FIRE_SERVICE_KEY", "DATA_GO_KR_SERVICE_KEY", "SERVICE_KEY"):
        v = (os.environ.get(name) or "").strip()
        if v:
            return v
    for path in (ML_SERVICE_ENV, FRONTEND_ENV_LOCAL):
        v = _read_env_key(
            path, ("FOREST_FIRE_SERVICE_KEY", "DATA_GO_KR_SERVICE_KEY", "SERVICE_KEY")
        )
        if v:
            return v
    raise RuntimeError(
        "산불 OpenAPI 키가 없습니다. ml-service/.env 에 "
        "FOREST_FIRE_SERVICE_KEY=공공데이터포털_인증키 를 넣어 주세요."
    )


def _local(tag: str) -> str:
    if "}" in tag:
        return tag.rsplit("}", 1)[-1]
    return tag


def _text(el: ET.Element | None) -> str:
    if el is None or el.text is None:
        return ""
    return str(el.text).strip()


def _parse_items(xml_text: str) -> tuple[list[dict], int, str]:
    root = ET.fromstring(xml_text)
    result_code = ""
    result_msg = ""
    total = 0
    items: list[dict] = []

    for el in root.iter():
        name = _local(el.tag)
        if name == "resultCode":
            result_code = _text(el)
        elif name == "resultMsg":
            result_msg = _text(el)
        elif name == "totalCount":
            try:
                total = int(_text(el) or "0")
            except ValueError:
                total = 0

    if result_code and result_code not in ("00", "0"):
        raise RuntimeError(f"OpenAPI 오류 [{result_code}] {result_msg}")

    for el in root.iter():
        if _local(el.tag) != "item":
            continue
        row = {_local(child.tag): _text(child) for child in list(el)}
        if row:
            items.append(row)
    return items, total, result_msg or "OK"


def _build_url(
    *,
    start: str,
    end: str,
    page_no: int,
    num_of_rows: int,
    key: str,
) -> str:
    # data.go.kr 는 serviceKey 를 디코딩하지 않는 경우가 있어 이중 인코딩 주의.
    # 키가 '%'를 포함하면 그대로, 아니면 quote.
    params = {
        "serviceKey": key,
        "numOfRows": str(num_of_rows),
        "pageNo": str(page_no),
        "searchStDt": start,
        "searchEdDt": end,
    }
    if "%" in key:
        qs = urllib.parse.urlencode(params, safe="%*")
    else:
        qs = urllib.parse.urlencode(params)
    return f"{API_URL}?{qs}"


def _http_get(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "wildfire-atlas/1.0"})
    last_err: Exception | None = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT_SEC) as resp:
                return resp.read()
        except urllib.error.HTTPError as e:
            body = ""
            try:
                body = e.read().decode("utf-8", errors="replace")[:300]
            except Exception:
                pass
            raise RuntimeError(
                f"OpenAPI HTTP {e.code}: {e.reason}"
                + (f" — {body}" if body else "")
            ) from e
        except (TimeoutError, urllib.error.URLError, OSError) as e:
            last_err = e
            if attempt >= MAX_RETRIES:
                break
            time.sleep(1.5 * attempt)
    raise RuntimeError(
        f"OpenAPI 연결 실패 (재시도 {MAX_RETRIES}회): {last_err}"
    ) from last_err


def fetch_page(
    *,
    start: str,
    end: str,
    page_no: int = 1,
    num_of_rows: int = 100,
    key: str | None = None,
) -> tuple[list[dict], int]:
    """start/end: YYYYMMDD"""
    key = key or service_key()
    url = _build_url(
        start=start, end=end, page_no=page_no, num_of_rows=num_of_rows, key=key
    )
    raw = _http_get(url)
    for enc in ("utf-8", "euc-kr", "cp949"):
        try:
            text = raw.decode(enc)
            break
        except UnicodeDecodeError:
            continue
    else:
        text = raw.decode("utf-8", errors="replace")
    items, total, _ = _parse_items(text)
    return items, total


def fetch_range(
    *,
    start: str,
    end: str,
    num_of_rows: int = 100,
    max_pages: int = 200,
) -> list[dict]:
    all_items: list[dict] = []
    page = 1
    total = None
    while page <= max_pages:
        items, tot = fetch_page(
            start=start, end=end, page_no=page, num_of_rows=num_of_rows
        )
        if total is None:
            total = tot
        all_items.extend(items)
        if not items:
            break
        if total is not None and len(all_items) >= total:
            break
        if len(items) < num_of_rows:
            break
        page += 1
    return all_items
