"""환경변수 · 경로 · 서버 바인딩 설정."""

from __future__ import annotations

import os
from pathlib import Path

SERVICE_DIR = Path(__file__).resolve().parent
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


def bootstrap() -> None:
    load_all_dotenv()


# import 시점에 .env 반영 후 바인딩 값 확정
load_all_dotenv()
HOST = os.environ.get("ML_HOST", "127.0.0.1")
PORT = int(os.environ.get("ML_PORT", "5000"))
