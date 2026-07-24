"""루트의 ASOS 분할 CSV를 하나로 합쳐 db/raw/weather/asos_daily_2011_2026.csv 생성."""

from __future__ import annotations

import pandas as pd

from paths import DATA_RAW, RAW_ASOS_DAILY, RAW_ASOS_PARTS, ensure_dirs


def main() -> None:
    ensure_dirs()
    (DATA_RAW / "weather").mkdir(parents=True, exist_ok=True)

    frames = []
    for p in RAW_ASOS_PARTS:
        if not p.exists():
            raise FileNotFoundError(p)
        df = pd.read_csv(p, encoding="cp949")
        print(f"로드 {p.name}: {len(df):,}행")
        frames.append(df)

    out = pd.concat(frames, ignore_index=True)
    # 일시 기준 중복 제거 (지점+일시)
    date_col = "일시"
    stn_col = "지점"
    out[date_col] = pd.to_datetime(out[date_col], errors="coerce")
    out = out.dropna(subset=[date_col, stn_col])
    before = len(out)
    out = out.sort_values([stn_col, date_col]).drop_duplicates(
        [stn_col, date_col], keep="last"
    )
    out[date_col] = out[date_col].dt.strftime("%Y-%m-%d")
    out.to_csv(RAW_ASOS_DAILY, index=False, encoding="cp949")
    print(
        f"저장 {RAW_ASOS_DAILY.name}: {len(out):,}행 "
        f"(중복제거 {before - len(out):,}) / "
        f"{out[date_col].min()} ~ {out[date_col].max()}"
    )


if __name__ == "__main__":
    main()
