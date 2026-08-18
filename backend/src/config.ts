import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** ForestFire 저장소 루트 */
export const ROOT = path.resolve(__dirname, "../..");

dotenv.config({ path: path.join(ROOT, "backend", ".env") });

export const PORT = Number(process.env.PORT || 4000);
export const FRONTEND_ORIGIN =
  process.env.FRONTEND_ORIGIN || "http://localhost:3000";
export const ML_SERVICE_URL = (
  process.env.ML_SERVICE_URL || "http://127.0.0.1:5000"
).replace(/\/$/, "");
export const PREDICT_CACHE_MS = Number(
  process.env.PREDICT_CACHE_MS || 30 * 60 * 1000,
);

/** MariaDB — 회원·챗봇 영속화 · 산불이력 동기화 (미설정이면 챗봇은 동작, 대화는 저장 안 함) */
export const DB_HOST = (process.env.DB_HOST || "").trim();
export const DB_PORT = Number(process.env.DB_PORT || 3306);
export const DB_USER = (process.env.DB_USER || "").trim();
export const DB_PASSWORD = process.env.DB_PASSWORD || "";
export const DB_NAME = (process.env.DB_NAME || "").trim();

/** Google Gemini — 안내 챗봇 (미설정이면 /api/chat → 503) */
export const GEMINI_API_KEY = (process.env.GEMINI_API_KEY || "")
  .trim()
  .replace(/^['"]|['"]$/g, "");
export const GEMINI_MODEL =
  (process.env.GEMINI_MODEL || "").trim().replace(/^['"]|['"]$/g, "") ||
  "gemini-2.5-flash";

/** 로그인 세션 쿠키 서명 비밀값 (미설정 시 개발용 기본값 — 배포 전 반드시 변경) */
export const SESSION_SECRET =
  (process.env.SESSION_SECRET || "").trim() ||
  "dev-only-forestfire-session-secret-change-me";
export const SESSION_COOKIE = "ff_session";
export const SESSION_DAYS = Number(process.env.SESSION_DAYS || 14);

/**
 * backend 자체 지도 데이터 폴더 (frontend 폴더를 직접 읽지 않음).
 * 웹 산불이력 갱신은 이 폴더의 map-data.json / admin-*.json 만 패치합니다.
 * 최초 지도 JSON은 etl이 만들고 배포 시 여기로 넣습니다.
 * 다른 위치를 쓰려면 .env의 DATA_DIR에 ROOT 기준 상대경로를 지정하세요.
 */
export const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(ROOT, process.env.DATA_DIR)
  : path.join(ROOT, "backend", "data");
