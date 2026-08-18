/**
 * 회원 인증 API — 기존 forest_fire_DB.users 기준.
 * POST /api/auth/login | /register | /logout
 * GET  /api/auth/me
 */
import bcrypt from "bcryptjs";
import { Router } from "express";
import {
  validateLoginId,
  validatePassword,
  validatePasswordConfirm,
} from "../lib/authValidation.js";
import { isDbConfigured } from "../lib/db.js";
import {
  createLocalUser,
  findUserByLoginId,
  isUserActive,
  rowToAuthUser,
} from "../lib/users.js";
import {
  SESSION_COOKIE,
  attachSessionCookie,
} from "../lib/session.js";
import { optionalAuth, requireAuth } from "../middleware/optionalAuth.js";

const router = Router();
const BCRYPT_ROUNDS = 12;

function readLoginId(body: unknown): string {
  const rec = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  return String(rec.loginId ?? rec.email ?? "").trim().toLowerCase();
}

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
    return res.json({ ok: true, user: null, expiresAt: null });
  }
  return res.json({
    ok: true,
    user: req.user,
    expiresAt: req.sessionExp ? req.sessionExp * 1000 : null,
  });
});

router.post("/auth/login", async (req, res) => {
  if (!dbRequired(res)) return;
  const loginId = readLoginId(req.body);
  const password = String(req.body?.password || "");
  if (!loginId || !password) {
    return res.status(400).json({ ok: false, error: "아이디와 비밀번호를 입력해 주세요." });
  }

  try {
    const row = await findUserByLoginId(loginId);
    if (!row || !isUserActive(row)) {
      return res.status(401).json({ ok: false, error: "아이디 또는 비밀번호가 올바르지 않습니다." });
    }
    if (!row.password) {
      const provider = String(row.social_provider || "SOCIAL").toUpperCase();
      return res.status(401).json({
        ok: false,
        error: `${provider} 소셜 계정입니다. 아이디 비밀번호 로그인은 로컬 계정만 지원합니다.`,
      });
    }
    const ok = await bcrypt.compare(password, row.password);
    if (!ok) {
      return res.status(401).json({ ok: false, error: "아이디 또는 비밀번호가 올바르지 않습니다." });
    }

    const user = rowToAuthUser(row);
    const expiresAt = attachSessionCookie(res, user.id);
    return res.json({ ok: true, user, expiresAt });
  } catch (e) {
    console.error("[auth/login]", e);
    return res.status(502).json({ ok: false, error: "로그인 처리에 실패했습니다." });
  }
});

router.post("/auth/register", async (req, res) => {
  if (!dbRequired(res)) return;
  const loginId = readLoginId(req.body);
  const password = String(req.body?.password || "");
  const passwordConfirm = String(req.body?.passwordConfirm ?? "");
  const name = String(req.body?.name || "").trim();
  const nickname = String(req.body?.nickname || "").trim();

  if (!loginId || !password || !name || !nickname) {
    return res.status(400).json({
      ok: false,
      error: "아이디, 비밀번호, 이름, 닉네임을 모두 입력해 주세요.",
    });
  }

  const idError = validateLoginId(loginId);
  if (idError) return res.status(400).json({ ok: false, error: idError });

  const pwError = validatePassword(password);
  if (pwError) return res.status(400).json({ ok: false, error: pwError });

  const confirmError = validatePasswordConfirm(password, passwordConfirm);
  if (confirmError) return res.status(400).json({ ok: false, error: confirmError });

  if (nickname.length < 2 || nickname.length > 50) {
    return res.status(400).json({ ok: false, error: "닉네임은 2~50자로 입력해 주세요." });
  }

  try {
    const existing = await findUserByLoginId(loginId);
    if (existing) {
      return res.status(409).json({ ok: false, error: "이미 가입된 아이디입니다." });
    }
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const row = await createLocalUser({ loginId, passwordHash, name, nickname });
    const user = rowToAuthUser(row);
    const expiresAt = attachSessionCookie(res, user.id);
    return res.status(201).json({ ok: true, user, expiresAt });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/Duplicate|ER_DUP_ENTRY/i.test(msg)) {
      return res.status(409).json({ ok: false, error: "이미 사용 중인 아이디 또는 닉네임입니다." });
    }
    console.error("[auth/register]", e);
    return res.status(502).json({ ok: false, error: "회원가입에 실패했습니다." });
  }
});

router.post("/auth/extend", requireAuth, (req, res) => {
  const user = req.user!;
  const expiresAt = attachSessionCookie(res, user.id);
  return res.json({ ok: true, user, expiresAt });
});

router.post("/auth/logout", (_req, res) => {
  res.clearCookie(SESSION_COOKIE, { path: "/" });
  return res.json({ ok: true });
});

export default router;
