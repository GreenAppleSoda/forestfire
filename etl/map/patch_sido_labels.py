"""admin-sido.json 라벨을 시청·도청 좌표로 즉시 패치."""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from map.build_admin_layers import PROV_FULL, SIDO_OFFICE_WGS84, wgs84_to_svg
from paths import ADMIN_SIDO_JSON


def main() -> None:
    data = json.loads(ADMIN_SIDO_JSON.read_text(encoding="utf-8"))
    for r in data["regions"]:
        prov = r.get("province") or ""
        raw = r.get("name") or ""
        for k, full in PROV_FULL.items():
            if full in raw:
                prov = k
                break
        if "광주" in raw and "전남" in raw:
            prov = "전남"
        ll = SIDO_OFFICE_WGS84.get(prov)
        if not ll:
            print("skip", r["name"], prov)
            continue
        sx, sy = wgs84_to_svg(ll[0], ll[1])
        old = r.get("label")
        r["x"], r["y"] = sx, sy
        r["label"] = [sx, sy]
        print(f"{r['name']} ({prov}): {old} -> {[sx, sy]}")
    ADMIN_SIDO_JSON.write_text(
        json.dumps(data, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    print("updated", ADMIN_SIDO_JSON)


if __name__ == "__main__":
    main()
