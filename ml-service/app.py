"""
산불 당일 위험 예측 — Flask (내부 전용)

Express(backend/)만 이 서비스를 호출한다. 브라우저에서 직접 열지 말 것.
기존 ml-service/predict/ 예측 엔진을 호출한다.
"""

from __future__ import annotations

import logging
import sys
from pathlib import Path

# ml-service/ 를 import root 로 (routes · services · config)
_SERVICE_DIR = Path(__file__).resolve().parent
if str(_SERVICE_DIR) not in sys.path:
    sys.path.insert(0, str(_SERVICE_DIR))

import config  # noqa: E402

config.bootstrap()

from flask import Flask  # noqa: E402

from routes import register_blueprints  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s [ml-service] %(message)s")


def create_app() -> Flask:
    app = Flask(__name__)
    register_blueprints(app)
    return app


app = create_app()


if __name__ == "__main__":
    # 127.0.0.1 만 바인딩 — 외부 직접 접근 방지
    app.run(host=config.HOST, port=config.PORT, debug=False, threaded=True)
