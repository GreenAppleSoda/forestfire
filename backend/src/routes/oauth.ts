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
  normalizeOAuthIntent,
  OAUTH_STATE_COOKIE,
  oauthStateCookieOptions,
  parseOAuthState,
  type OAuthIntent,
  type OAuthProvider,
} from "../lib/oauth.js";
import { attachSessionCookie } from "../lib/session.js";
import {
  createSocialUser,
  findUserBySocial,
  isUserActive,
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

function startOAuth(res: Response, provider: OAuthProvider, intentRaw: unknown) {
  if (!isDbConfigured()) {
    return redirectHome(res, { auth_error: "db_not_configured" });
  }
  if (provider === "google" && !isGoogleConfigured()) {
    return redirectHome(res, { auth_error: "google_not_configured" });
  }
  if (provider === "kakao" && !isKakaoConfigured()) {
    return redirectHome(res, { auth_error: "kakao_not_configured" });
  }
  const intent = normalizeOAuthIntent(intentRaw);
  const state = newOAuthState(provider, intent);
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
  const parsed = parseOAuthState(state);
  if (
    !state ||
    !expected ||
    state !== expected ||
    !parsed ||
    parsed.provider !== provider
  ) {
    return redirectHome(res, { auth_error: "state_mismatch" });
  }
  const intent: OAuthIntent = parsed.intent;
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
      if (intent === "login") {
        return redirectHome(res, { auth_error: "social_not_registered" });
      }
      row = await createSocialUser({
        provider: dbProvider,
        socialId: profile.socialId,
        email: profile.email,
        name: profile.name,
        nickname: profile.nickname,
      });
    } else if (intent === "register") {
      return redirectHome(res, { auth_error: "social_already_registered" });
    }
    if (!isUserActive(row)) {
      return redirectHome(res, { auth_error: "inactive" });
    }
    attachSessionCookie(res, Number(row.id));
    return redirectHome(res, { auth: "ok" });
  } catch (e) {
    console.error(`[auth/${provider}/callback]`, e);
    return redirectHome(res, { auth_error: "profile_failed" });
  }
}

router.get("/auth/google", (req, res) =>
  startOAuth(res, "google", req.query?.intent),
);
router.get("/auth/kakao", (req, res) =>
  startOAuth(res, "kakao", req.query?.intent),
);

router.get("/auth/google/callback", (req, res) => {
  void finishOAuth(res, "google", req.query, req.cookies?.[OAUTH_STATE_COOKIE]);
});
router.get("/auth/kakao/callback", (req, res) => {
  void finishOAuth(res, "kakao", req.query, req.cookies?.[OAUTH_STATE_COOKIE]);
});

export default router;
