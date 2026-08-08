"""환경변수 · 경로 · 서버 바인딩 설정."""

from __future__ import annotations

import os
import sys
from pathlib import Path

SERVICE_DIR = Path(__file__).resolve().parent
ROOT = SERVICE_DIR.parent
ETL = ROOT / "etl"
ENV_FILE = SERVICE_DIR / ".env"


def load_dotenv(path: Path = ENV_FILE) -> None:
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, val = line.split("=", 1)
        key = key.strip()
        val = val.strip().strip('"').strip("'")
        os.environ.setdefault(key, val)


def load_all_dotenv() -> None:
    """ml-service/.env 파일 로드."""
    load_dotenv(ENV_FILE)


def ensure_etl_path() -> None:
    """etl/ 를 import path 에 넣는다.

    예측(predict/) 기능은 ml_paths.py · predict/kma_client.py 로 자체 해결되어
    더 이상 필요 없다. 이력 동기화(routes/sync.py → pipeline.sync_wildfire_history)
    만 etl/pipeline 을 그대로 재사용하므로 그 기능을 위해서만 남겨 둔다.
    """
    if str(ETL) not in sys.path:
        sys.path.insert(0, str(ETL))


def bootstrap() -> None:
    load_all_dotenv()
    # ml-service/ 는 app 진입 시 이미 path 에 있음. etl 만 보강(동기화 기능용).
    ensure_etl_path()


# import 시점에 .env 반영 후 바인딩 값 확정
load_all_dotenv()
HOST = os.environ.get("ML_HOST", "127.0.0.1")
PORT = int(os.environ.get("ML_PORT", "5000"))
