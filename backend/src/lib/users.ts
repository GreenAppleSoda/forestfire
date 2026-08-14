/**
 * users 테이블 ↔ AuthUser 매핑.
 * 권한은 비회원/회원만 구분한다 (세션 유무). 구독 등급 컬럼은 쓰지 않는다.
 */
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import type { AuthUser } from "../types/express.js";
import { getPool } from "./db.js";

type UserRow = RowDataPacket & {
  id: number;
  email: string;
  password: string | null;
  name: string;
  nickname: string;
  role: string;
  status: string;
  social_provider: string;
  deleted_at: Date | string | null;
};

export function rowToAuthUser(row: UserRow): AuthUser {
  return {
    id: Number(row.id),
    email: String(row.email),
    name: String(row.name),
    nickname: String(row.nickname),
    role: String(row.role || "ROLE_USER"),
  };
}

const USER_SELECT = `
  SELECT id, email, password, name, nickname, role, status,
         social_provider, deleted_at
  FROM users
`;

export async function findUserByEmail(email: string): Promise<UserRow | null> {
  const pool = getPool();
  const [rows] = await pool.query<UserRow[]>(
    `${USER_SELECT} WHERE LOWER(email) = ? LIMIT 1`,
    [email.trim().toLowerCase()],
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

export async function createLocalUser(input: {
  email: string;
  passwordHash: string;
  name: string;
  nickname: string;
}): Promise<UserRow> {
  const pool = getPool();
  const email = input.email.trim().toLowerCase();
  const [result] = await pool.query<ResultSetHeader>(
    `INSERT INTO users
      (email, password, name, nickname, role, status, social_provider)
     VALUES (?, ?, ?, ?, 'ROLE_USER', 'ACTIVE', 'LOCAL')`,
    [email, input.passwordHash, input.name.trim(), input.nickname.trim()],
  );
  const created = await findUserById(Number(result.insertId));
  if (!created) throw new Error("failed to load created user");
  return created;
}

export type { UserRow };
