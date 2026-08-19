"use client";

import { useAuth } from "@/lib/authContext";
import {
  validateLoginId,
  validatePassword,
  validatePasswordConfirm,
} from "@/lib/authValidation";
import { useEffect, useState } from "react";

type Mode = "login" | "register";

type Props = {
  open: boolean;
  mode: Mode;
  onClose: () => void;
};

export function AuthModal({ open, mode, onClose }: Props) {
  const { login, register, oauthError } = useAuth();
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [name, setName] = useState("");
  const [nickname, setNickname] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoginId("");
    setPassword("");
    setPasswordConfirm("");
    setName("");
    setNickname("");
    setError(null);
    setBusy(false);
  }, [open, mode]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      if (mode === "login") {
        await login(loginId, password);
      } else {
        const idError = validateLoginId(loginId);
        if (idError) throw new Error(idError);
        const pwError = validatePassword(password);
        if (pwError) throw new Error(pwError);
        const confirmError = validatePasswordConfirm(password, passwordConfirm);
        if (confirmError) throw new Error(confirmError);
        await register({ loginId, password, passwordConfirm, name, nickname });
      }
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const title = mode === "login" ? "로그인" : "회원가입";
  const oauthIntent = mode === "register" ? "register" : "login";

  return (
    <div
      className="fixed inset-0 z-[80] grid place-items-center bg-black/40 px-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="w-full max-w-[360px] rounded-2xl bg-white px-5 py-5 shadow-[var(--shadow-card)] ring-1 ring-[#e5e7eb]"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="auth-modal-title"
      >
        <div className="relative">
          <h2
            id="auth-modal-title"
            className="text-center text-[16px] font-semibold text-[#111827]"
          >
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="absolute top-1/2 right-0 -translate-y-1/2 rounded-lg px-2 py-1 text-sm text-[#6b7280] hover:bg-[#f3f4f6] hover:text-[#111827]"
            aria-label="닫기"
          >
            ✕
          </button>
        </div>

        <form
          className="mt-4 space-y-2.5"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          {mode === "register" && (
            <>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="이름"
                className="w-full rounded-xl border border-[#e5e7eb] px-3 py-2.5 text-[13px]"
                autoComplete="name"
                required
              />
              <input
                type="text"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                placeholder="닉네임"
                className="w-full rounded-xl border border-[#e5e7eb] px-3 py-2.5 text-[13px]"
                autoComplete="nickname"
                required
              />
            </>
          )}
          <input
            type="text"
            value={loginId}
            onChange={(e) => setLoginId(e.target.value.toLowerCase())}
            placeholder={
              mode === "register" ? "아이디 (영문 소문자로 시작, 4~20자)" : "아이디"
            }
            className="w-full rounded-xl border border-[#e5e7eb] px-3 py-2.5 text-[13px]"
            autoComplete="username"
            maxLength={20}
            required
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={
              mode === "register" ? "비밀번호 (8~20자, 2종 이상 조합)" : "비밀번호"
            }
            className="w-full rounded-xl border border-[#e5e7eb] px-3 py-2.5 text-[13px]"
            autoComplete={mode === "register" ? "new-password" : "current-password"}
            maxLength={20}
            required
          />
          {mode === "register" && (
            <input
              type="password"
              value={passwordConfirm}
              onChange={(e) => setPasswordConfirm(e.target.value)}
              placeholder="비밀번호 확인"
              className="w-full rounded-xl border border-[#e5e7eb] px-3 py-2.5 text-[13px]"
              autoComplete="new-password"
              maxLength={20}
              required
            />
          )}
          {error && <p className="text-[12px] text-[#e03131]">{error}</p>}
          {!error && oauthError && (
            <p className="text-[12px] text-[#e03131]">{oauthError}</p>
          )}
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-xl bg-[#2563eb] px-3 py-2.5 text-[13px] font-semibold text-white transition hover:bg-[#1d4ed8] disabled:opacity-40"
          >
            {busy ? "처리 중…" : title}
          </button>
        </form>
        <div className="mt-3 flex items-center gap-2">
          <span className="h-px flex-1 bg-[#e5e7eb]" />
          <span className="text-[11px] text-[#9ca3af]">또는</span>
          <span className="h-px flex-1 bg-[#e5e7eb]" />
        </div>
        <div className="mt-3 space-y-2">
          <a
            href={`/api/auth/google?intent=${oauthIntent}`}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-[#e5e7eb] bg-white px-3 py-2.5 text-[13px] font-semibold text-[#111827] transition hover:bg-[#f9fafb]"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden>
              <path
                fill="#4285F4"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="#34A853"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="#FBBC05"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
              />
              <path
                fill="#EA4335"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              />
            </svg>
            Google로 시작
          </a>
          <a
            href={`/api/auth/kakao?intent=${oauthIntent}`}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#FEE500] px-3 py-2.5 text-[13px] font-semibold text-[#191919] transition hover:bg-[#f6dc00]"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden>
              <path
                fill="#191919"
                d="M12 4C7.03 4 3 7.14 3 11c0 2.5 1.67 4.7 4.18 5.96-.18.66-.64 2.4-.73 2.77 0 0-.14.42.22.23.15-.08 2.4-1.64 2.77-1.9.82.12 1.67.18 2.56.18 4.97 0 9-3.14 9-7S16.97 4 12 4z"
              />
            </svg>
            카카오로 시작
          </a>
        </div>
      </div>
    </div>
  );
}
