"""MariaDB forestfire_stats → admin/map-data 이력 갱신.

사용:
  python etl/pipeline/sync_wildfire_history.py
  python etl/pipeline/sync_wildfire_history.py --skip-map-refresh

환경변수: ml-service/.env 의 DB_* (MariaDB)
로컬 refined_wildfire_data.csv 는 더 이상 쓰지 않는다.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # etl/
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "ml-service"))

from map.refresh_history_layers import refresh_history_layers
from paths import WILDFIRE_OPENAPI_STATE, ensure_dirs


def run_sync(*, skip_map_refresh: bool = False) -> dict:
    """DB 산불이력으로 맵 레이어를 갱신한다."""
    ensure_dirs()
    from predict.fire_db import fetch_forestfire_stats_df

    fires = fetch_forestfire_stats_df()

    refresh_info = None
    if not skip_map_refresh:
        refresh_info = refresh_history_layers(fires)

    state = {
        "last_sync_at": datetime.now().isoformat(timespec="seconds"),
        "source": "mariadb:forestfire_stats",
        "fetched": int(len(fires)),
        "added": 0,
        "refined_total": int(len(fires)),
        "map_refresh": refresh_info,
    }
    WILDFIRE_OPENAPI_STATE.write_text(
        json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return {"ok": True, **state}


def main() -> None:
    parser = argparse.ArgumentParser(description="MariaDB 산불이력 → 맵 갱신")
    parser.add_argument("--skip-map-refresh", action="store_true")
    args = parser.parse_args()
    result = run_sync(skip_map_refresh=args.skip_map_refresh)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
