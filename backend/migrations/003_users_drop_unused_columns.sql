-- users: 구독 등급·전화번호 컬럼 정리
-- 실행: mysql -h <host> -u <user> -p forest_fire_DB < 003_users_drop_unused_columns.sql
--
-- 권한은 비회원/회원(세션)만 구분한다.
-- phone_number 는 앱에서 쓰지 않는다.
-- grade / subscription_tier 가 남아 있으면 함께 제거한다.

ALTER TABLE users
  DROP COLUMN IF EXISTS phone_number,
  DROP COLUMN IF EXISTS subscription_tier,
  DROP COLUMN IF EXISTS grade;
