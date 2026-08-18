/**
 * users 테이블 ↔ AuthUser 매핑.
 * 권한은 비회원/회원만 구분한다 (세션 유무). 구독 등급 컬럼은 쓰지 않는다.
 */
import { randomBytes } from "node:crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import type { AuthUser } from "../types/express.js";
import { getPool } from "./db.js";

export type SocialProvider = "LOCAL" | "GOOGLE" | "KAKAO";

type UserRow = RowDataPacket & {
  id: number;
  login_id: string | null;
  email: string | null;
  password: string | null;
  name: string;
  nickname: string;
  role: string;
  status: string;
  social_provider: string;
  social_id: string | null;
  deleted_at: Date | string | null;
};

export function rowToAuthUser(row: UserRow): AuthUser {
  return {
    id: Number(row.id),
    loginId: row.login_id ? String(row.login_id) : "",
    email: row.email ? String(row.email) : "",
    name: String(row.name),
    nickname: String(row.nickname),
    role: String(row.role || "ROLE_USER"),
  };
}

const USER_SELECT = `
  SELECT id, login_id, email, password, name, nickname, role, status,
         social_provider, social_id, deleted_at
  FROM users
`;

export async function findUserByLoginId(loginId: string): Promise<UserRow | null> {
  const pool = getPool();
  const [rows] = await pool.query<UserRow[]>(
    `${USER_SELECT} WHERE LOWER(login_id) = ? LIMIT 1`,
    [loginId.trim().toLowerCase()],
  );
  return rows[0] ?? null;
}

export async function findUserBySocial(
  provider: Exclude<SocialProvider, "LOCAL">,
  socialId: string,
): Promise<UserRow | null> {
  const pool = getPool();
  const [rows] = await pool.query<UserRow[]>(
    `${USER_SELECT} WHERE social_provider = ? AND social_id = ? LIMIT 1`,
    [provider, socialId],
  );
  return rows[0] ?? null;
}

export async function findUserById(id: number): Promise<UserRow | null> {
  const pool = getPool();
  const [rows] = await pool.query<UserRow[]>(`${USER_SELECT} WHERE id = ? LIMIT 1`, [id]);
  return rows[0] ?? null;
}

export function isUserActive(row: UserRow): boolean {
  if (row.deleted_at) return false;
  return String(row.status || "").toUpperCase() === "ACTIVE";
}

async function nicknameTaken(nickname: string): Promise<boolean> {
  const pool = getPool();
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT id FROM users WHERE nickname = ? LIMIT 1",
    [nickname],
  );
  return rows.length > 0;
}

export async function allocateNickname(preferred: string): Promise<string> {
  const cleaned = preferred.replace(/\s+/g, " ").trim().slice(0, 50);
  const base = cleaned.length >= 2 ? cleaned : "사용자";
  if (!(await nicknameTaken(base))) return base;
  for (let i = 0; i < 8; i += 1) {
    const suffix = randomBytes(2).toString("hex");
    const next = `${base.slice(0, 45)}_${suffix}`;
    if (!(await nicknameTaken(next))) return next;
  }
  return `${base.slice(0, 40)}_${Date.now().toString(36)}`.slice(0, 50);
}

export async function createLocalUser(input: {
  loginId: string;
  passwordHash: string;
  name: string;
  nickname: string;
}): Promise<UserRow> {
  const pool = getPool();
  const loginId = input.loginId.trim().toLowerCase();
  const [result] = await pool.query<ResultSetHeader>(
    `INSERT INTO users
      (login_id, email, password, name, nickname, role, status, social_provider, social_id)
     VALUES (?, NULL, ?, ?, ?, 'ROLE_USER', 'ACTIVE', 'LOCAL', NULL)`,
    [loginId, input.passwordHash, input.name.trim(), input.nickname.trim()],
  );
  const created = await findUserById(Number(result.insertId));
  if (!created) throw new Error("failed to load created user");
  return created;
}

export async function createSocialUser(input: {
  provider: Exclude<SocialProvider, "LOCAL">;
  socialId: string;
  email: string | null;
  name: string;
  nickname: string;
}): Promise<UserRow> {
  const pool = getPool();
  const nickname = await allocateNickname(input.nickname);
  const name = input.name.trim() || nickname;
  const email = input.email ? input.email.trim().toLowerCase() : null;
  const [result] = await pool.query<ResultSetHeader>(
    `INSERT INTO users
      (login_id, email, password, name, nickname, role, status, social_provider, social_id)
     VALUES (NULL, ?, NULL, ?, ?, 'ROLE_USER', 'ACTIVE', ?, ?)`,
    [email, name, nickname, input.provider, input.socialId],
  );
  const created = await findUserById(Number(result.insertId));
  if (!created) throw new Error("failed to load created social user");
  return created;
}

export type { UserRow };
