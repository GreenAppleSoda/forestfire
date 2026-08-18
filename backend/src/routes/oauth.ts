/**
 * GET /api/auth/google | /kakao  → 제공자 동의 화면
 * GET /api/auth/google/callback | /kakao/callback
 */
import type { CookieOptions, Response } from "express";
import { Router } from "express";
import { FRONTEND_ORIGIN } from "../config.js";
import { isDbConfigured } from "../lib/db.js";
import {
  fetchGoogleProfile,
  fetchKakaoProfile,
  googleAuthorizeUrl,
  isGoogleConfigured,
  isKakaoConfigured,
  kakaoAuthorizeUrl,
  newOAuthState,
  OAUTH_STATE_COOKIE,
  oauthStateCookieOptions,
  parseOAuthState,
  type OAuthProvider,
} from "../lib/oauth.js";
import {
  createSessionToken,
  SESSION_COOKIE,
  sessionCookieOptions,
} from "../lib/session.js";
import {
  createSocialUser,
  findUserBySocial,
  isUserActive,
  rowToAuthUser,
} from "../lib/users.js";

const router = Router();

function redirectHome(res: Response, params: Record<string, string>) {
  const url = new URL(FRONTEND_ORIGIN);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  res.clearCookie(OAUTH_STATE_COOKIE, { path: "/" });
  return res.redirect(url.toString());
}

function startOAuth(res: Response, provider: OAuthProvider) {
  if (!isDbConfigured()) {
    return redirectHome(res, { auth_error: "db_not_configured" });
  }
  if (provider === "google" && !isGoogleConfigured()) {
    return redirectHome(res, { auth_error: "google_not_configured" });
  }
  if (provider === "kakao" && !isKakaoConfigured()) {
    return redirectHome(res, { auth_error: "kakao_not_configured" });
  }
  const state = newOAuthState(provider);
  res.cookie(OAUTH_STATE_COOKIE, state, oauthStateCookieOptions() as CookieOptions);
  const dest =
    provider === "google" ? googleAuthorizeUrl(state) : kakaoAuthorizeUrl(state);
  return res.redirect(dest);
}

async function finishOAuth(
  res: Response,
  provider: OAuthProvider,
  query: { code?: unknown; state?: unknown; error?: unknown },
  cookieState: unknown,
) {
  if (!isDbConfigured()) {
    return redirectHome(res, { auth_error: "db_not_configured" });
  }
  if (String(query.error || "") === "access_denied") {
    return redirectHome(res, { auth_error: "cancelled" });
  }
  const state = String(query.state || "");
  const expected = String(cookieState || "");
  if (!state || !expected || state !== expected || parseOAuthState(state) !== provider) {
    return redirectHome(res, { auth_error: "state_mismatch" });
  }
  const code = String(query.code || "");
  if (!code) {
    return redirectHome(res, { auth_error: "cancelled" });
  }

  try {
    const profile =
      provider === "google"
        ? await fetchGoogleProfile(code)
        : await fetchKakaoProfile(code);
    const dbProvider = provider === "google" ? "GOOGLE" : "KAKAO";
    let row = await findUserBySocial(dbProvider, profile.socialId);
    if (!row) {
      row = await createSocialUser({
        provider: dbProvider,
        socialId: profile.socialId,
        email: profile.email,
        name: profile.name,
        nickname: profile.nickname,
      });
    }
    if (!isUserActive(row)) {
      return redirectHome(res, { auth_error: "inactive" });
    }
    const user = rowToAuthUser(row);
    const token = createSessionToken(user.id);
    res.cookie(SESSION_COOKIE, token, sessionCookieOptions());
    return redirectHome(res, { auth: "ok" });
  } catch (e) {
    console.error(`[auth/${provider}/callback]`, e);
    return redirectHome(res, { auth_error: "profile_failed" });
  }
}

router.get("/auth/google", (_req, res) => startOAuth(res, "google"));
router.get("/auth/kakao", (_req, res) => startOAuth(res, "kakao"));

router.get("/auth/google/callback", (req, res) => {
  void finishOAuth(res, "google", req.query, req.cookies?.[OAUTH_STATE_COOKIE]);
});
router.get("/auth/kakao/callback", (req, res) => {
  void finishOAuth(res, "kakao", req.query, req.cookies?.[OAUTH_STATE_COOKIE]);
});

export default router;
