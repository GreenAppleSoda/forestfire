/**
 * 서명 세션 쿠키 (HMAC-SHA256).
 * 형식: base64url(payloadJson).base64url(signature)
 * 유휴 만료: SESSION_IDLE_MS (기본 30분)
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Response } from "express";
import {
  SESSION_COOKIE,
  SESSION_IDLE_MS,
  SESSION_SECRET,
} from "../config.js";

export type SessionPayload = {
  uid: number;
  exp: number; // unix seconds
};

function b64url(buf: Buffer | string): string {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf, "utf8");
  return b.toString("base64url");
}

function sign(data: string): string {
  return createHmac("sha256", SESSION_SECRET).update(data).digest("base64url");
}

export function createSession(userId: number): {
  token: string;
  expiresAt: number;
} {
  const exp = Math.floor((Date.now() + SESSION_IDLE_MS) / 1000);
  const payload: SessionPayload = { uid: userId, exp };
  const body = b64url(JSON.stringify(payload));
  return {
    token: `${body}.${sign(body)}`,
    expiresAt: exp * 1000,
  };
}

export function verifySessionToken(token: string): SessionPayload | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  if (!body || !sig) return null;
  const expected = sign(body);
  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SessionPayload;
    if (!payload?.uid || !payload?.exp) return null;
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp < now) return null;
    // 예전 14일 쿠키는 즉시 무효
    const maxLeft = Math.floor(SESSION_IDLE_MS / 1000) + 120;
    if (payload.exp - now > maxLeft) return null;
    return payload;
  } catch {
    return null;
  }
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: false,
    path: "/",
    maxAge: SESSION_IDLE_MS,
  };
}

export function attachSessionCookie(res: Response, userId: number): number {
  const { token, expiresAt } = createSession(userId);
  res.cookie(SESSION_COOKIE, token, sessionCookieOptions());
  return expiresAt;
}

export { SESSION_COOKIE };
