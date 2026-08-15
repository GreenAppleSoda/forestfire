"""Flask 블루프린트 등록."""

from __future__ import annotations

from flask import Flask

from routes.health import bp as health_bp
from routes.predict import bp as predict_bp
from routes.report import bp as report_bp
from routes.sync import bp as sync_bp


def register_blueprints(app: Flask) -> None:
    app.register_blueprint(health_bp)
    app.register_blueprint(predict_bp)
    app.register_blueprint(report_bp)
    app.register_blueprint(sync_bp)
