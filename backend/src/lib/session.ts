/**
 * 서명 세션 쿠키 (HMAC-SHA256).
 * 형식: base64url(payloadJson).base64url(signature)
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { SESSION_COOKIE, SESSION_DAYS, SESSION_SECRET } from "../config.js";

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

export function createSessionToken(userId: number): string {
  const payload: SessionPayload = {
    uid: userId,
    exp: Math.floor(Date.now() / 1000) + SESSION_DAYS * 24 * 60 * 60,
  };
  const body = b64url(JSON.stringify(payload));
  return `${body}.${sign(body)}`;
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
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

export function sessionCookieOptions(maxAgeMs?: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: false,
    path: "/",
    maxAge: maxAgeMs ?? SESSION_DAYS * 24 * 60 * 60 * 1000,
  };
}

export { SESSION_COOKIE };
