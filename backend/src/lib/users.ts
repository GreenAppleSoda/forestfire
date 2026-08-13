/**
 * users 테이블 ↔ AuthUser 매핑.
 * subscription_tier: BASIC | PLUS | PREMIUM (users 캐시 컬럼)
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
  subscription_tier: string;
  deleted_at: Date | string | null;
};

/** PREMIUM=1, PLUS=2, BASIC=3 (챗봇·권한 안내용) */
export function tierToGrade(tier: string): number {
  const t = tier.toUpperCase();
  if (t === "PREMIUM") return 1;
  if (t === "PLUS") return 2;
  return 3;
}

export function rowToAuthUser(row: UserRow): AuthUser {
  const subscriptionTier = String(row.subscription_tier || "BASIC").toUpperCase();
  return {
    id: Number(row.id),
    email: String(row.email),
    name: String(row.name),
    nickname: String(row.nickname),
    role: String(row.role || "ROLE_USER"),
    subscriptionTier,
    grade: tierToGrade(subscriptionTier),
  };
}

const USER_SELECT = `
  SELECT id, email, password, name, nickname, role, status,
         social_provider, subscription_tier, deleted_at
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
      (email, password, name, nickname, role, status, social_provider, subscription_tier)
     VALUES (?, ?, ?, ?, 'ROLE_USER', 'ACTIVE', 'LOCAL', 'BASIC')`,
    [email, input.passwordHash, input.name.trim(), input.nickname.trim()],
  );
  const created = await findUserById(Number(result.insertId));
  if (!created) throw new Error("failed to load created user");
  return created;
}

export type { UserRow };
