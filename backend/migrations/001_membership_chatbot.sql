-- 챗봇 세션·메시지 테이블 (기존 forest_fire_DB.users 기준)
-- 실행: mysql -h <host> -u <user> -p forest_fire_DB < 001_membership_chatbot.sql
--
-- 주의: 기존 users / user_subscriptions / payment_history 는 건드리지 않습니다.
-- user_id 는 users.id 를 참조합니다. id 타입이 다르면 FK 줄만 주석 해제 전 타입을 맞추세요.
-- (게스트 챗봇만 쓸 때는 user_id 가 항상 NULL 이어도 동작합니다.)

-- 1) 챗봇 세션 (비로그인 게스트 — user_id NULL 허용)
CREATE TABLE IF NOT EXISTS chat_sessions (
  id          VARCHAR(64)     PRIMARY KEY COMMENT 'client-generated UUID',
  user_id     INT             NULL COMMENT 'users.id (로그인 연동 시)',
  created_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_chat_sessions_user (user_id)
  -- 타입이 확인되면 아래 FK 를 추가하세요:
  -- , CONSTRAINT fk_chat_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- 2) 챗봇 메시지 로그
CREATE TABLE IF NOT EXISTS chat_messages (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  session_id  VARCHAR(64)              NOT NULL,
  role        ENUM('user','assistant') NOT NULL,
  content     MEDIUMTEXT               NOT NULL,
  created_at  DATETIME                 NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_chat_messages_session FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE,
  INDEX idx_chat_messages_session (session_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- (보류) 리포트·포인트 테이블은 회원/구독 연동 확정 후 별도 마이그레이션으로 추가합니다.
