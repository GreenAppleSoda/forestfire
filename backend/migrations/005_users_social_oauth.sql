-- 소셜 로그인: email · social_id, login_id 는 로컬 계정만 필수
-- 실행: mysql -h <host> -u <user> -p forest_fire_DB < 005_users_social_oauth.sql
-- 이미 컬럼이 있으면 ADD COLUMN IF NOT EXISTS 는 건너뛴다.

ALTER TABLE users
  MODIFY login_id VARCHAR(20) NULL;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS email VARCHAR(255) NULL,
  ADD COLUMN IF NOT EXISTS social_id VARCHAR(128) NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uk_users_social
  ON users (social_provider, social_id);
