-- 당일 예측 스냅샷 (헤더 런 + 시군구 행)
-- 실행: mysql -h <host> -u <user> -p forest_fire_DB < 002_daily_ml_risk.sql
--
-- 1시간(observed_at)마다 runs 1행 + regions 255행.
-- 챗봇·지도는 runs 에서 ORDER BY observed_at DESC LIMIT 1 후 해당 run_id 의 regions 를 읽는다.
-- 시나리오(사용자 지정) 예측은 넣지 않는다.
-- 같은 observed_at 으로 다시 예측하면 UPSERT 후 해당 run 의 regions 를 갈아끼운다.

-- 1) 예측 런 (시간별 스냅샷 헤더)
CREATE TABLE IF NOT EXISTS daily_ml_risk_runs (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  predict_date    DATE            NOT NULL COMMENT '예측일 (YYYY-MM-DD)',
  observed_at     DATETIME        NOT NULL COMMENT '기상청 시간자료 관측 시각',
  weather_source  VARCHAR(64)     NULL COMMENT '예: kma_hourly:202608140800',
  n_regions       INT             NULL,
  note            TEXT            NULL,
  sample_temp_avg     DOUBLE      NULL,
  sample_precip       DOUBLE      NULL,
  sample_wind_avg     DOUBLE      NULL,
  sample_humidity_avg DOUBLE      NULL,
  roc_auc         DOUBLE          NULL,
  pr_auc          DOUBLE          NULL,
  threshold       DOUBLE          NULL,
  mean_pred       DOUBLE          NULL,
  base_rate_test  DOUBLE          NULL,
  brier           DOUBLE          NULL,
  created_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_observed_at (observed_at),
  INDEX idx_predict_date (predict_date, observed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- 2) 런별 시군구 점수
CREATE TABLE IF NOT EXISTS daily_ml_risk_regions (
  run_id         BIGINT UNSIGNED NOT NULL,
  code           VARCHAR(10)     NOT NULL COMMENT '시군구 코드',
  name           VARCHAR(50)     NOT NULL,
  province       VARCHAR(20)     NOT NULL,
  ml_risk        DOUBLE          NOT NULL COMMENT 'XGB raw 확률 (위험지수 = ×100)',
  ml_risk_norm   DOUBLE          NOT NULL COMMENT '해당 런 내 상대 정규화 0~1 (시각 간 비교 금지)',
  humidity_avg   DOUBLE          NULL,
  temp_avg       DOUBLE          NULL,
  precip         DOUBLE          NULL,
  wind_avg       DOUBLE          NULL,
  PRIMARY KEY (run_id, code),
  INDEX idx_name (name),
  INDEX idx_ml_risk (run_id, ml_risk),
  CONSTRAINT fk_daily_ml_risk_run
    FOREIGN KEY (run_id) REFERENCES daily_ml_risk_runs(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
