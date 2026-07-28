"""법정동코드 전체자료 → 지역명 정규화용 lookup JSON.

사용:
  python etl/pipeline/build_legal_dong_lookup.py

입력 (우선순위):
  1) db-archive/raw/legal_dong_codes.txt
  2) 프로젝트 루트/법정동코드 전체자료.txt  (CP949)

출력:
  db-archive/processed/legal_dong_lookup.json
  frontend/public/data/legal-dong-lookup.json
"""

from __future__ import annotations

import json
import re
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from paths import (
    DATA_PROCESSED_ETL,
    DATA_RAW,
    FRONTEND_PUBLIC_DATA,
    ROOT,
    ensure_dirs,
)

RAW_CANDIDATES = [
    DATA_RAW / "legal_dong_codes.txt",
    ROOT / "법정동코드 전체자료.txt",
]
LOOKUP_ETL = DATA_PROCESSED_ETL / "legal_dong_lookup.json"
LOOKUP_WEB = FRONTEND_PUBLIC_DATA / "legal-dong-lookup.json"

# OpenAPI·구자료에서 자주 쓰는 시도 약칭 → 표시용 공식명
SIDO_ALIASES = {
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
    "강원도": "강원특별자치도",
    "충북": "충청북도",
    "충남": "충청남도",
    "전북": "전북특별자치도",
    "전북도": "전북특별자치도",
    "전라북도": "전북특별자치도",
    "전남": "전라남도",
    "전라도": "전라남도",
    "경북": "경상북도",
    "경남": "경상남도",
    "제주": "제주특별자치도",
    "제주도": "제주특별자치도",
    # 최신 법정동 통합명 → 기존 표기 (OpenAPI·지도와 맞춤)
    "전남광주통합특별시": "전라남도",
    "전남광주통합": "전라남도",
}

# 전남광주통합특별시 중 구(舊 광주광역시)
GWANGJU_GU = {"동구", "서구", "남구", "북구", "광산구"}


def legacy_sido_parents(sido: str, sig: str) -> list[str]:
    """lookup 키에 쓸 상위 시도명들 (통합특별시 → 전라남도/광주광역시 병행)."""
    parents = [sido]
    if sido == "전남광주통합특별시":
        if sig in GWANGJU_GU:
            parents.extend(["광주광역시", "광주"])
        else:
            parents.extend(["전라남도", "전남"])
    return parents


def strip_key(name: str) -> str:
    s = re.sub(r"\s+", "", str(name).strip())
    s = re.sub(
        r"(특별자치시|광역시|특별시|특별자치도|자치도)$",
        "",
        s,
    )
    s = re.sub(r"(시|군|구|읍|면|동|리|가)$", "", s)
    return s


def load_rows(path: Path) -> list[tuple[str, str]]:
    raw = path.read_bytes()
    for enc in ("cp949", "euc-kr", "utf-8-sig", "utf-8"):
        try:
            text = raw.decode(enc)
            break
        except UnicodeDecodeError:
            continue
    else:
        raise RuntimeError(f"인코딩을 알 수 없음: {path}")

    rows: list[tuple[str, str]] = []
    for i, line in enumerate(text.splitlines()):
        if not line.strip():
            continue
        parts = line.split("\t")
        if len(parts) < 2:
            continue
        code, name = parts[0].strip(), parts[1].strip()
        status = parts[2].strip() if len(parts) > 2 else "존재"
        if i == 0 and "코드" in code:
            continue
        if status and status != "존재":
            continue
        if not code.isdigit() or len(code) < 2:
            continue
        rows.append((code, name))
    return rows


def build_lookup(rows: list[tuple[str, str]]) -> dict:
    """계층별 strip_key → 공식명. 충돌 시 후보를 모아 유일할 때만 채택."""
    sido_official: dict[str, str] = {}
    sig_cands: dict[str, set[str]] = defaultdict(set)
    emd_cands: dict[str, set[str]] = defaultdict(set)
    li_cands: dict[str, set[str]] = defaultdict(set)

    for code, full in rows:
        tokens = full.split()
        if not tokens:
            continue
        n = len(tokens)
        if n >= 1 and code.endswith("00000000"):
            sido_official[tokens[0]] = tokens[0]
            continue
        if n >= 2 and code.endswith("00000"):
            sido, sig = tokens[0], tokens[1]
            sido_official[sido] = sido
            for parent in legacy_sido_parents(sido, sig):
                sig_cands[f"{parent}|{strip_key(sig)}"].add(sig)
                sig_cands[f"{parent}|{sig}"].add(sig)
            continue
        if n >= 3 and code.endswith("00"):
            sido, sig, emd = tokens[0], tokens[1], tokens[2]
            sido_official[sido] = sido
            for parent in legacy_sido_parents(sido, sig):
                sig_cands[f"{parent}|{strip_key(sig)}"].add(sig)
                sig_cands[f"{parent}|{sig}"].add(sig)
                emd_cands[f"{parent}|{sig}|{strip_key(emd)}"].add(emd)
                emd_cands[f"{parent}|{sig}|{emd}"].add(emd)
            continue
        if n >= 4:
            sido, sig, emd, li = tokens[0], tokens[1], tokens[2], tokens[3]
            sido_official[sido] = sido
            for parent in legacy_sido_parents(sido, sig):
                sig_cands[f"{parent}|{strip_key(sig)}"].add(sig)
                emd_cands[f"{parent}|{sig}|{strip_key(emd)}"].add(emd)
                li_cands[f"{parent}|{sig}|{emd}|{strip_key(li)}"].add(li)
                li_cands[f"{parent}|{sig}|{emd}|{li}"].add(li)

    def uniq(cands: dict[str, set[str]]) -> dict[str, str]:
        out: dict[str, str] = {}
        for k, names in cands.items():
            if len(names) == 1:
                out[k] = next(iter(names))
        return out

    display_targets = {
        "서울특별시",
        "부산광역시",
        "대구광역시",
        "인천광역시",
        "광주광역시",
        "대전광역시",
        "울산광역시",
        "세종특별자치시",
        "경기도",
        "강원특별자치도",
        "충청북도",
        "충청남도",
        "전북특별자치도",
        "전라남도",
        "경상북도",
        "경상남도",
        "제주특별자치도",
    }
    sido: dict[str, str] = {}
    for full in display_targets:
        sido[full] = full
        sk = strip_key(full)
        if sk:
            sido[sk] = full
    for alias, full in SIDO_ALIASES.items():
        sido[alias] = full
        sk = strip_key(alias)
        if sk:
            sido[sk] = full
    for full in sido_official.values():
        if full not in sido:
            sido[full] = SIDO_ALIASES.get(full, full)

    return {
        "meta": {
            "source": "법정동코드 전체자료 (존재만)",
            "n_sido": len(set(sido.values())),
            "n_sigungu_keys": len(uniq(sig_cands)),
            "n_emd_keys": len(uniq(emd_cands)),
            "n_li_keys": len(uniq(li_cands)),
        },
        "sido": sido,
        "sigungu": uniq(sig_cands),
        "emd": uniq(emd_cands),
        "li": uniq(li_cands),
    }


def main() -> None:
    ensure_dirs()
    src = next((p for p in RAW_CANDIDATES if p.exists()), None)
    if not src:
        raise SystemExit(
            "법정동 원본이 없습니다. "
            f"다음 중 하나에 두세요: {RAW_CANDIDATES[0]} 또는 {RAW_CANDIDATES[1]}"
        )

    rows = load_rows(src)
    lookup = build_lookup(rows)
    text = json.dumps(lookup, ensure_ascii=False, separators=(",", ":"))
    LOOKUP_ETL.parent.mkdir(parents=True, exist_ok=True)
    LOOKUP_ETL.write_text(text, encoding="utf-8")
    LOOKUP_WEB.write_text(text, encoding="utf-8")

    # 원본을 archive에 UTF-8로도 보관 (없을 때만)
    archive = DATA_RAW / "legal_dong_codes.txt"
    if src.resolve() != archive.resolve():
        archive.parent.mkdir(parents=True, exist_ok=True)
        # 현존만 UTF-8 TSV로 저장
        lines = ["법정동코드\t법정동명\t폐지여부"]
        for code, name in rows:
            lines.append(f"{code}\t{name}\t존재")
        archive.write_text("\n".join(lines) + "\n", encoding="utf-8")

    m = lookup["meta"]
    print(f"원본: {src} ({len(rows):,}행 현존)")
    print(
        f"lookup: sido={m['n_sido']} sigungu_keys={m['n_sigungu_keys']} "
        f"emd_keys={m['n_emd_keys']} li_keys={m['n_li_keys']}"
    )
    print(f"저장: {LOOKUP_ETL}")
    print(f"저장: {LOOKUP_WEB}")
    # smoke
    assert lookup["sido"].get("경북") == "경상북도"
    assert lookup["sigungu"].get("경상북도|문경") == "문경시"
    assert lookup["emd"].get("경상북도|문경시|모전") == "모전동"
    assert lookup["sido"].get("전남") == "전라남도"
    assert lookup["sigungu"].get("전라남도|보성") == "보성군"
    assert lookup["emd"].get("전라남도|보성군|득량") == "득량면"
    print("smoke OK: 경북>문경>모전 / 전남>보성>득량")


if __name__ == "__main__":
    main()
