"""지역별 산불위험 PDF 리포트 생성.

daily_ml_risk 예측 결과(payload) + 사용자가 지정한 지역(시·도 또는 시군구)을 받아
frontend 산불위험 브리핑과 동일한 시각 양식의 PDF를 만든다.

진입점: generate.generate_report()
"""

from __future__ import annotations

from report.generate import generate_report

__all__ = ["generate_report"]
