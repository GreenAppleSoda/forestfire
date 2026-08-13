/**
 * 쿠키 세션이 있으면 req.user 를 채운다. 없어도 통과 (게스트 허용).
 */
import type { NextFunction, Request, Response } from "express";
import { isDbConfigured } from "../lib/db.js";
import { findUserById, isUserActive, rowToAuthUser } from "../lib/users.js";
import { SESSION_COOKIE, verifySessionToken } from "../lib/session.js";

export async function optionalAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!isDbConfigured()) {
      next();
      return;
    }
    const raw = req.cookies?.[SESSION_COOKIE];
    if (!raw || typeof raw !== "string") {
      next();
      return;
    }
    const payload = verifySessionToken(raw);
    if (!payload) {
      next();
      return;
    }
    const row = await findUserById(payload.uid);
    if (!row || !isUserActive(row)) {
      next();
      return;
    }
    req.user = rowToAuthUser(row);
    next();
  } catch (e) {
    console.error("[optionalAuth]", e);
    next();
  }
}

/** 로그인 필수 */
export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  await optionalAuth(req, res, () => {
    if (!req.user) {
      res.status(401).json({ ok: false, error: "로그인이 필요합니다." });
      return;
    }
    next();
  });
}
