"use client";

import { readApiJson } from "@/lib/apiJson";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type AuthUser = {
  id: number;
  loginId: string;
  email: string;
  name: string;
  nickname: string;
  role: string;
};

type AuthState = {
  user: AuthUser | null;
  expiresAt: number | null;
  loading: boolean;
  oauthError: string | null;
  clearOauthError: () => void;
  refresh: () => Promise<void>;
  extendSession: () => Promise<void>;
  login: (loginId: string, password: string) => Promise<void>;
  register: (input: {
    loginId: string;
    password: string;
    passwordConfirm: string;
    name: string;
    nickname: string;
  }) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

type AuthJson = {
  ok?: boolean;
  user?: AuthUser | null;
  expiresAt?: number | null;
  error?: string;
};

async function parseAuthSession(res: Response): Promise<{
  user: AuthUser | null;
  expiresAt: number | null;
}> {
  const json = await readApiJson<AuthJson>(res);
  if (!res.ok || !json.ok) {
    throw new Error(json.error || "인증 요청에 실패했습니다.");
  }
  return {
    user: json.user ?? null,
    expiresAt: typeof json.expiresAt === "number" ? json.expiresAt : null,
  };
}

const OAUTH_ERROR_MESSAGES: Record<string, string> = {
  cancelled: "소셜 로그인이 취소되었습니다.",
  google_not_configured: "구글 로그인이 아직 설정되지 않았습니다.",
  kakao_not_configured: "카카오 로그인이 아직 설정되지 않았습니다.",
  db_not_configured: "회원 DB가 설정되지 않았습니다.",
  state_mismatch: "소셜 로그인 검증에 실패했습니다. 다시 시도해 주세요.",
  profile_failed: "소셜 계정 정보를 가져오지 못했습니다.",
  inactive: "비활성화된 계정입니다.",
};

function oauthErrorMessage(code: string): string {
  return OAUTH_ERROR_MESSAGES[code] || "소셜 로그인에 실패했습니다.";
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [oauthError, setOauthError] = useState<string | null>(null);

  const applySession = useCallback((next: AuthUser | null, exp: number | null) => {
    setUser(next);
    setExpiresAt(next ? exp : null);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/me", { credentials: "include" });
      const json = await readApiJson<AuthJson>(res);
      if (res.ok && json.ok && json.user) {
        applySession(json.user, typeof json.expiresAt === "number" ? json.expiresAt : null);
      } else {
        applySession(null, null);
      }
    } catch {
      applySession(null, null);
    } finally {
      setLoading(false);
    }
  }, [applySession]);

  const clearOauthError = useCallback(() => setOauthError(null), []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const err = params.get("auth_error");
    if (err) setOauthError(oauthErrorMessage(err));
    if (err || params.get("auth") === "ok") {
      params.delete("auth");
      params.delete("auth_error");
      const next = `${window.location.pathname}${params.toString() ? `?${params}` : ""}${window.location.hash}`;
      window.history.replaceState({}, "", next);
    }
  }, []);

  const login = useCallback(
    async (loginId: string, password: string) => {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ loginId, password }),
      });
      const next = await parseAuthSession(res);
      applySession(next.user, next.expiresAt);
    },
    [applySession],
  );

  const register = useCallback(
    async (input: {
      loginId: string;
      password: string;
      passwordConfirm: string;
      name: string;
      nickname: string;
    }) => {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const next = await parseAuthSession(res);
      applySession(next.user, next.expiresAt);
    },
    [applySession],
  );

  const extendSession = useCallback(async () => {
    const res = await fetch("/api/auth/extend", {
      method: "POST",
      credentials: "include",
    });
    if (res.status === 401) {
      applySession(null, null);
      return;
    }
    const next = await parseAuthSession(res);
    applySession(next.user, next.expiresAt);
  }, [applySession]);

  const logout = useCallback(async () => {
    await fetch("/api/auth/logout", {
      method: "POST",
      credentials: "include",
    });
    applySession(null, null);
  }, [applySession]);

  const value = useMemo(
    () => ({
      user,
      expiresAt,
      loading,
      oauthError,
      clearOauthError,
      refresh,
      extendSession,
      login,
      register,
      logout,
    }),
    [
      user,
      expiresAt,
      loading,
      oauthError,
      clearOauthError,
      refresh,
      extendSession,
      login,
      register,
      logout,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return ctx;
}
