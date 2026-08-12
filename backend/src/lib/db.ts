/**
 * MariaDB 연결 풀 (챗봇 세션·메시지 영속화).
 * DB_* 미설정이면 isDbConfigured() === false → 챗봇은 동작하되 대화를 DB에 남기지 않음.
 */
import mysql from "mysql2/promise";
import {
  DB_HOST,
  DB_NAME,
  DB_PASSWORD,
  DB_PORT,
  DB_USER,
} from "../config.js";

let pool: mysql.Pool | null = null;

export function isDbConfigured(): boolean {
  return Boolean(DB_HOST && DB_USER && DB_NAME);
}

export function getPool(): mysql.Pool {
  if (!isDbConfigured()) {
    throw new Error("MariaDB is not configured (DB_HOST / DB_USER / DB_NAME)");
  }
  if (!pool) {
    pool = mysql.createPool({
      host: DB_HOST,
      port: DB_PORT,
      user: DB_USER,
      password: DB_PASSWORD,
      database: DB_NAME,
      waitForConnections: true,
      connectionLimit: 5,
      timezone: "Z",
    });
  }
  return pool;
}
