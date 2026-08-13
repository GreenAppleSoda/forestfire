/**
 * 회원 인증 API — 기존 forest_fire_DB.users 기준.
 * POST /api/auth/login | /register | /logout
 * GET  /api/auth/me
 */
import bcrypt from "bcryptjs";
import { Router } from "express";
import { isDbConfigured } from "../lib/db.js";
import {
  createLocalUser,
  findUserByEmail,
  isUserActive,
  rowToAuthUser,
} from "../lib/users.js";
import {
  SESSION_COOKIE,
  createSessionToken,
  sessionCookieOptions,
} from "../lib/session.js";
import { optionalAuth } from "../middleware/optionalAuth.js";

const router = Router();
const BCRYPT_ROUNDS = 12;

function dbRequired(
  res: import("express").Response,
): boolean {
  if (isDbConfigured()) return true;
  res.status(503).json({
    ok: false,
    error: "회원 DB가 설정되지 않았습니다. backend/.env 에 DB_* 를 넣어 주세요.",
  });
  return false;
}

router.get("/auth/me", optionalAuth, (req, res) => {
  if (!req.user) {
    return res.json({ ok: true, user: null });
  }
  return res.json({ ok: true, user: req.user });
});

router.post("/auth/login", async (req, res) => {
  if (!dbRequired(res)) return;
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");
  if (!email || !password) {
    return res.status(400).json({ ok: false, error: "이메일과 비밀번호를 입력해 주세요." });
  }

  try {
    const row = await findUserByEmail(email);
    if (!row || !isUserActive(row)) {
      return res.status(401).json({ ok: false, error: "이메일 또는 비밀번호가 올바르지 않습니다." });
    }
    if (!row.password) {
      const provider = String(row.social_provider || "SOCIAL").toUpperCase();
      return res.status(401).json({
        ok: false,
        error: `${provider} 소셜 계정입니다. 이메일 비밀번호 로그인은 로컬 계정만 지원합니다.`,
      });
    }
    const ok = await bcrypt.compare(password, row.password);
    if (!ok) {
      return res.status(401).json({ ok: false, error: "이메일 또는 비밀번호가 올바르지 않습니다." });
    }

    const user = rowToAuthUser(row);
    const token = createSessionToken(user.id);
    res.cookie(SESSION_COOKIE, token, sessionCookieOptions());
    return res.json({ ok: true, user });
  } catch (e) {
    console.error("[auth/login]", e);
    return res.status(502).json({ ok: false, error: "로그인 처리에 실패했습니다." });
  }
});

router.post("/auth/register", async (req, res) => {
  if (!dbRequired(res)) return;
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");
  const name = String(req.body?.name || "").trim();
  const nickname = String(req.body?.nickname || "").trim();

  if (!email || !password || !name || !nickname) {
    return res.status(400).json({
      ok: false,
      error: "이메일, 비밀번호, 이름, 닉네임을 모두 입력해 주세요.",
    });
  }
  if (password.length < 8) {
    return res.status(400).json({ ok: false, error: "비밀번호는 8자 이상이어야 합니다." });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ ok: false, error: "이메일 형식이 올바르지 않습니다." });
  }
  if (nickname.length < 2 || nickname.length > 50) {
    return res.status(400).json({ ok: false, error: "닉네임은 2~50자로 입력해 주세요." });
  }

  try {
    const existing = await findUserByEmail(email);
    if (existing) {
      return res.status(409).json({ ok: false, error: "이미 가입된 이메일입니다." });
    }
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const row = await createLocalUser({ email, passwordHash, name, nickname });
    const user = rowToAuthUser(row);
    const token = createSessionToken(user.id);
    res.cookie(SESSION_COOKIE, token, sessionCookieOptions());
    return res.status(201).json({ ok: true, user });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/Duplicate|ER_DUP_ENTRY/i.test(msg)) {
      return res.status(409).json({ ok: false, error: "이미 사용 중인 이메일 또는 닉네임입니다." });
    }
    console.error("[auth/register]", e);
    return res.status(502).json({ ok: false, error: "회원가입에 실패했습니다." });
  }
});

router.post("/auth/logout", (_req, res) => {
  res.clearCookie(SESSION_COOKIE, { path: "/" });
  return res.json({ ok: true });
});

export default router;
