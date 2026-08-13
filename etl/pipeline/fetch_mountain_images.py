"""산림청 산정보 이미지(mntInfoImgOpenAPI2)를 받아 웹 정적 파일로 저장.

- 조회: cultureInfoService2 / mntInfoImgOpenAPI2  (파라미터 mntiListNo)
- 파일: https://www.forest.go.kr/images/data/down/mountain/{imgfilename}
- 저장: frontend/public/data/mountain-images/{산코드}.jpg
- map-data.json 의 mountains / catalog / top 에 image_url 을 붙임

런타임에서 OpenAPI를 치지 않습니다. 재실행 시 이미 받은 산은 건너뜁니다.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from pathlib import Path
from xml.etree import ElementTree as ET

import requests
from dotenv import load_dotenv

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from paths import (
    KOREA_MOUNTAINS_JSON,
    MAP_DATA_JSON,
    MOUNTAIN_IMAGES_DIR,
    MOUNTAIN_IMAGES_META,
    MOUNTAIN_IMAGES_PUBLIC_PREFIX,
    ROOT,
    ensure_dirs,
    sync_backend_data,
)

API_URL = (
    "https://apis.data.go.kr/1400000/service/cultureInfoService2/mntInfoImgOpenAPI2"
)
CDN_BASE = "https://www.forest.go.kr/images/data/down/mountain"
SAFE_FILE = re.compile(r"^[A-Za-z0-9._-]+\.(?:jpg|jpeg|png|gif|webp)$", re.I)
SAFE_ID = re.compile(r"^[A-Za-z0-9._-]+$")


def load_service_key() -> str:
    load_dotenv(ROOT / ".env")
    load_dotenv(ROOT / "etl" / ".env")
    key = os.getenv("FOREST_MOUNTAIN_SERVICE_KEY")
    if not key:
        raise SystemExit(".env에 FOREST_MOUNTAIN_SERVICE_KEY가 없습니다.")
    return key


def public_url(mntn_id: str, suffix: str = ".jpg") -> str:
    return f"{MOUNTAIN_IMAGES_PUBLIC_PREFIX}/{mntn_id}{suffix}"


def load_meta() -> dict[str, dict]:
    if not MOUNTAIN_IMAGES_META.exists():
        return {}
    try:
        raw = json.loads(MOUNTAIN_IMAGES_META.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}
    return raw if isinstance(raw, dict) else {}


def save_meta(meta: dict[str, dict]) -> None:
    MOUNTAIN_IMAGES_META.parent.mkdir(parents=True, exist_ok=True)
    MOUNTAIN_IMAGES_META.write_text(
        json.dumps(meta, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def load_image_urls_by_id() -> dict[str, str]:
    """디스크에 있는 산 사진만 id → 웹 경로."""
    out: dict[str, str] = {}
    if not MOUNTAIN_IMAGES_DIR.exists():
        return out
    for p in MOUNTAIN_IMAGES_DIR.iterdir():
        if not p.is_file() or p.suffix.lower() not in {".jpg", ".jpeg", ".png", ".gif", ".webp"}:
            continue
        if not SAFE_ID.match(p.stem):
            continue
        out[p.stem] = f"{MOUNTAIN_IMAGES_PUBLIC_PREFIX}/{p.name}"
    return out


def existing_image_path(mntn_id: str) -> Path | None:
    for ext in (".jpg", ".jpeg", ".png", ".gif", ".webp"):
        p = MOUNTAIN_IMAGES_DIR / f"{mntn_id}{ext}"
        if p.is_file() and p.stat().st_size > 0:
            return p
    return None


def pick_filename(items: list[dict[str, str]]) -> str:
    if not items:
        return ""
    numbered = [it for it in items if str(it.get("imgno") or "") == "1"]
    chosen = numbered[0] if numbered else items[0]
    name = (chosen.get("imgfilename") or "").strip()
    return name if SAFE_FILE.match(name) else ""


def parse_image_items(xml_bytes: bytes) -> tuple[list[dict[str, str]], str, str]:
    root = ET.fromstring(xml_bytes)
    code = (root.findtext(".//resultCode") or "").strip()
    msg = (root.findtext(".//resultMsg") or "").strip()
    items: list[dict[str, str]] = []
    for item in root.iter("item"):
        row = {child.tag: (child.text or "").strip() for child in item}
        if row:
            items.append(row)
    return items, code, msg


def fetch_image_items(
    session: requests.Session,
    service_key: str,
    mntn_id: str,
) -> list[dict[str, str]]:
    resp = session.get(
        API_URL,
        params={
            "serviceKey": service_key,
            "mntiListNo": mntn_id,
            "pageNo": "1",
            "numOfRows": "20",
        },
        timeout=60,
    )
    resp.raise_for_status()
    items, code, msg = parse_image_items(resp.content)
    if code and code not in {"00", "0"}:
        raise RuntimeError(f"API {code} {msg}")
    return items


def download_image(session: requests.Session, filename: str, dest: Path) -> bool:
    url = f"{CDN_BASE}/{filename}"
    resp = session.get(
        url,
        timeout=60,
        headers={"User-Agent": "forestfire-atlas/1.0"},
    )
    if resp.status_code != 200:
        return False
    ctype = (resp.headers.get("content-type") or "").lower()
    body = resp.content
    if len(body) < 200:
        return False
    if "image/" not in ctype and body[:3] != b"\xff\xd8\xff" and body[:8] != b"\x89PNG\r\n\x1a\n":
        return False
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(body)
    return True


def collect_mountain_ids(catalog_first: bool) -> list[str]:
    ids: list[str] = []
    seen: set[str] = set()

    def add(mid: object) -> None:
        s = str(mid or "").strip()
        if not s or s in seen or not SAFE_ID.match(s):
            return
        seen.add(s)
        ids.append(s)

    if MAP_DATA_JSON.exists():
        data = json.loads(MAP_DATA_JSON.read_text(encoding="utf-8"))
        if catalog_first:
            for region in data.get("regions") or []:
                for key in ("catalog_mountains", "top_mountains"):
                    for m in region.get(key) or []:
                        if isinstance(m, dict):
                            add(m.get("id"))
        for mid in (data.get("mountains") or {}):
            add(mid)

    if KOREA_MOUNTAINS_JSON.exists():
        raw = json.loads(KOREA_MOUNTAINS_JSON.read_text(encoding="utf-8"))
        if isinstance(raw, list):
            for item in raw:
                if isinstance(item, dict):
                    add(item.get("mntilistno"))

    return ids


def patch_map_data_images(urls: dict[str, str] | None = None) -> int:
    """map-data.json 산 객체에 image_url 을 반영."""
    if not MAP_DATA_JSON.exists():
        return 0
    urls = urls if urls is not None else load_image_urls_by_id()
    data = json.loads(MAP_DATA_JSON.read_text(encoding="utf-8"))
    n = 0

    def apply(obj: dict) -> None:
        nonlocal n
        mid = str(obj.get("id") or "")
        url = urls.get(mid)
        if url:
            if obj.get("image_url") != url:
                obj["image_url"] = url
                n += 1
        elif "image_url" in obj:
            obj.pop("image_url", None)
            n += 1

    for m in (data.get("mountains") or {}).values():
        if isinstance(m, dict):
            apply(m)
    for region in data.get("regions") or []:
        for key in ("catalog_mountains", "top_mountains"):
            for m in region.get(key) or []:
                if isinstance(m, dict):
                    apply(m)

    MAP_DATA_JSON.write_text(
        json.dumps(data, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    sync_backend_data()
    return n


def main() -> None:
    parser = argparse.ArgumentParser(description="산림청 산 이미지 수집 (mntInfoImgOpenAPI2)")
    parser.add_argument("--sleep", type=float, default=0.18, help="API 호출 간격(초)")
    parser.add_argument("--limit", type=int, default=0, help="최대 조회 수 (0=전체)")
    parser.add_argument("--force", action="store_true", help="이미 받은 산도 다시 조회")
    parser.add_argument(
        "--catalog-only",
        action="store_true",
        help="산도감·연계 산에 나온 id만 조회",
    )
    parser.add_argument(
        "--skip-download",
        action="store_true",
        help="메타만 조회하고 파일은 받지 않음",
    )
    args = parser.parse_args()

    ensure_dirs()
    service_key = load_service_key()
    meta = load_meta()
    ids = collect_mountain_ids(catalog_first=True)
    if args.catalog_only and MAP_DATA_JSON.exists():
        data = json.loads(MAP_DATA_JSON.read_text(encoding="utf-8"))
        keep: set[str] = set()
        for region in data.get("regions") or []:
            for key in ("catalog_mountains", "top_mountains"):
                for m in region.get(key) or []:
                    if isinstance(m, dict) and m.get("id"):
                        keep.add(str(m["id"]))
        ids = [i for i in ids if i in keep]

    if args.limit > 0:
        ids = ids[: args.limit]

    session = requests.Session()
    ok = none = err = skipped = 0
    print(f"대상 {len(ids)}산  (force={args.force})", flush=True)

    for i, mid in enumerate(ids, 1):
        local = existing_image_path(mid)
        prev = meta.get(mid) or {}
        if not args.force and local is not None:
            meta[mid] = {
                **prev,
                "status": "ok",
                "path": public_url(mid, local.suffix.lower()),
            }
            skipped += 1
            continue
        if not args.force and prev.get("status") == "none":
            skipped += 1
            continue

        try:
            time.sleep(args.sleep)
            items = fetch_image_items(session, service_key, mid)
        except Exception as exc:
            meta[mid] = {"status": "error", "error": str(exc)[:200]}
            err += 1
            print(f"[{i}/{len(ids)}] {mid} error {exc}", flush=True)
            continue

        filename = pick_filename(items)
        if not filename:
            meta[mid] = {"status": "none", "count": len(items)}
            none += 1
            if i % 50 == 0:
                print(f"[{i}/{len(ids)}] none={none} ok={ok} skip={skipped} err={err}", flush=True)
            continue

        dest = MOUNTAIN_IMAGES_DIR / f"{mid}{Path(filename).suffix.lower()}"
        saved = False
        if not args.skip_download:
            try:
                saved = download_image(session, filename, dest)
            except Exception as exc:
                meta[mid] = {
                    "status": "error",
                    "filename": filename,
                    "error": str(exc)[:200],
                }
                err += 1
                print(f"[{i}/{len(ids)}] {mid} download {exc}", flush=True)
                continue

        if args.skip_download or saved:
            path = public_url(mid, dest.suffix.lower())
            meta[mid] = {
                "status": "ok",
                "filename": filename,
                "count": len(items),
                "path": path,
            }
            ok += 1
            print(f"[{i}/{len(ids)}] {mid} {filename}", flush=True)
            if ok % 80 == 0:
                save_meta(meta)
                patch_map_data_images()
        else:
            meta[mid] = {"status": "error", "filename": filename, "error": "download failed"}
            err += 1
            print(f"[{i}/{len(ids)}] {mid} download failed {filename}", flush=True)

        if (ok + none + err) % 40 == 0:
            save_meta(meta)

    save_meta(meta)
    urls = load_image_urls_by_id()
    patched = patch_map_data_images(urls)
    print(
        f"done ok={ok} none={none} skip={skipped} err={err} "
        f"files={len(urls)} map_patched={patched}",
        flush=True,
    )


if __name__ == "__main__":
    main()
