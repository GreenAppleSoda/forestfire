-- 챗봇 세션·메시지 테이블 (기존 forest_fire_DB.users 기준)
-- 실행: mysql -h <host> -u <user> -p forest_fire_DB < 001_membership_chatbot.sql
--
-- 주의: 기존 users 테이블은 건드리지 않습니다. (구독/결제 테이블은 사용하지 않음)
-- users.id 는 bigint — chat_sessions.user_id 도 bigint 로 맞춤.
-- 보고서는 DB에 저장하지 않고 로그인 회원에게 조회 시 생성해 보여 줍니다.

-- 1) 챗봇 세션 (비로그인 게스트 — user_id NULL 허용)
CREATE TABLE IF NOT EXISTS chat_sessions (
  id          VARCHAR(64)     PRIMARY KEY COMMENT 'client-generated UUID',
  user_id     BIGINT          NULL COMMENT 'users.id (로그인 연동 시)',
  created_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_chat_sessions_user (user_id),
  CONSTRAINT fk_chat_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
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
