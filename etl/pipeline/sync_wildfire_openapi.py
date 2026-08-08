"""[deprecated] OpenAPI 증분 동기화.

산불이력은 MariaDB forestfire_stats 를 씁니다.
→ pipeline.sync_wildfire_history.run_sync
"""

from __future__ import annotations

from pipeline.sync_wildfire_history import run_sync

__all__ = ["run_sync"]
