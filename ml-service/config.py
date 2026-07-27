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


def ensure_etl_path() -> None:
    """etl/ 를 import path 에 넣어 ml·pipeline 모듈을 재사용."""
    if str(ETL) not in sys.path:
        sys.path.insert(0, str(ETL))


def bootstrap() -> None:
    load_dotenv()
    ensure_etl_path()


# import 시점에 .env 반영 후 바인딩 값 확정
load_dotenv()
HOST = os.environ.get("ML_HOST", "127.0.0.1")
PORT = int(os.environ.get("ML_PORT", "5000"))
