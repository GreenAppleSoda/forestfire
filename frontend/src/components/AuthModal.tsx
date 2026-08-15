"use client";

import { useAuth } from "@/lib/authContext";
import { useEffect, useState } from "react";

type Mode = "login" | "register";

type Props = {
  open: boolean;
  mode: Mode;
  onClose: () => void;
};

export function AuthModal({ open, mode, onClose }: Props) {
  const { login, register } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [nickname, setNickname] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setEmail("");
    setPassword("");
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
        await login(email, password);
      } else {
        await register({ email, password, name, nickname });
      }
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const title = mode === "login" ? "로그인" : "회원가입";

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
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="아이디"
            className="w-full rounded-xl border border-[#e5e7eb] px-3 py-2.5 text-[13px]"
            autoComplete="email"
            required
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={mode === "register" ? "비밀번호 (8자 이상)" : "비밀번호"}
            className="w-full rounded-xl border border-[#e5e7eb] px-3 py-2.5 text-[13px]"
            autoComplete={mode === "register" ? "new-password" : "current-password"}
            required
          />
          {error && <p className="text-[12px] text-[#e03131]">{error}</p>}
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-xl bg-[#2563eb] px-3 py-2.5 text-[13px] font-semibold text-white transition hover:bg-[#1d4ed8] disabled:opacity-40"
          >
            {busy ? "처리 중…" : title}
          </button>
        </form>
      </div>
    </div>
  );
}
