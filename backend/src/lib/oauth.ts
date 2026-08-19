/**
 * Google · Kakao OAuth (authorization code).
 * 콜백 URL 은 FRONTEND_ORIGIN/api/auth/{provider}/callback (Next 프록시).
 */
import { randomBytes } from "node:crypto";
import {
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  KAKAO_CLIENT_SECRET,
  KAKAO_REST_API_KEY,
  OAUTH_REDIRECT_BASE,
} from "../config.js";

export const OAUTH_STATE_COOKIE = "ff_oauth_state";

export type OAuthProvider = "google" | "kakao";
export type OAuthIntent = "login" | "register";

export type SocialProfile = {
  socialId: string;
  email: string | null;
  name: string;
  nickname: string;
};

export function isGoogleConfigured(): boolean {
  return Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET);
}

export function isKakaoConfigured(): boolean {
  return Boolean(KAKAO_REST_API_KEY);
}

export function oauthCallbackUrl(provider: OAuthProvider): string {
  return `${OAUTH_REDIRECT_BASE}/api/auth/${provider}/callback`;
}

export function normalizeOAuthIntent(v: unknown): OAuthIntent {
  return String(v || "").toLowerCase() === "register" ? "register" : "login";
}

export function newOAuthState(provider: OAuthProvider, intent: OAuthIntent): string {
  return `${provider}.${intent}.${randomBytes(16).toString("hex")}`;
}

export function parseOAuthState(
  state: string,
): { provider: OAuthProvider; intent: OAuthIntent } | null {
  const [provider, intent] = state.split(".", 3);
  if (provider !== "google" && provider !== "kakao") return null;
  if (intent !== "login" && intent !== "register") return null;
  return { provider, intent };
}

export function oauthStateCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: false,
    path: "/",
    maxAge: 10 * 60 * 1000,
  };
}

export function googleAuthorizeUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: oauthCallbackUrl("google"),
    response_type: "code",
    scope: "openid email profile",
    state,
    prompt: "select_account",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export function kakaoAuthorizeUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: KAKAO_REST_API_KEY,
    redirect_uri: oauthCallbackUrl("kakao"),
    response_type: "code",
    state,
    scope: "profile_nickname,",
  });
  return `https://kauth.kakao.com/oauth/authorize?${params.toString()}`;
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { raw: text };
  }
}

function str(v: unknown): string {
  return v == null ? "" : String(v).trim();
}

export async function fetchGoogleProfile(code: string): Promise<SocialProfile> {
  const body = new URLSearchParams({
    code,
    client_id: GOOGLE_CLIENT_ID,
    client_secret: GOOGLE_CLIENT_SECRET,
    redirect_uri: oauthCallbackUrl("google"),
    grant_type: "authorization_code",
  });
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const tokenJson = await readJson(tokenRes);
  const accessToken = str(tokenJson.access_token);
  if (!tokenRes.ok || !accessToken) {
    throw new Error("google_token_failed");
  }

  const meRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const me = await readJson(meRes);
  const socialId = str(me.sub);
  if (!meRes.ok || !socialId) {
    throw new Error("google_profile_failed");
  }
  const name = str(me.name) || str(me.given_name) || "Google 사용자";
  const email = str(me.email) || null;
  return { socialId, email, name, nickname: name };
}

export async function fetchKakaoProfile(code: string): Promise<SocialProfile> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: KAKAO_REST_API_KEY,
    redirect_uri: oauthCallbackUrl("kakao"),
    code,
  });
  if (KAKAO_CLIENT_SECRET) body.set("client_secret", KAKAO_CLIENT_SECRET);

  const tokenRes = await fetch("https://kauth.kakao.com/oauth/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=utf-8",
    },
    body,
  });
  const tokenJson = await readJson(tokenRes);
  const accessToken = str(tokenJson.access_token);
  if (!tokenRes.ok || !accessToken) {
    throw new Error("kakao_token_failed");
  }

  const meRes = await fetch("https://kapi.kakao.com/v2/user/me", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/x-www-form-urlencoded;charset=utf-8",
    },
  });
  const me = await readJson(meRes);
  const socialId = str(me.id);
  if (!meRes.ok || !socialId) {
    throw new Error("kakao_profile_failed");
  }
  const account =
    me.kakao_account && typeof me.kakao_account === "object"
      ? (me.kakao_account as Record<string, unknown>)
      : {};
  const profile =
    account.profile && typeof account.profile === "object"
      ? (account.profile as Record<string, unknown>)
      : {};
  const nickname = str(profile.nickname) || "카카오 사용자";
  const email = str(account.email) || null;
  return { socialId, email, name: nickname, nickname };
}
