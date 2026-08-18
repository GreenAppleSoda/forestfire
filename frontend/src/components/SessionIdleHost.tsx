"use client";

import { useAuth } from "@/lib/authContext";
import { useCallback, useEffect, useRef, useState } from "react";

const WARN_MS = 5 * 60 * 1000;
const EXTEND_THROTTLE_MS = 60 * 1000;

export function SessionIdleHost() {
  const { user, expiresAt, extendSession, logout } = useAuth();
  const [now, setNow] = useState(() => Date.now());
  const lastExtendAt = useRef(0);
  const extending = useRef(false);
  const loggingOut = useRef(false);

  const remainingMs = expiresAt != null ? expiresAt - now : null;
  const showWarn =
    Boolean(user) && remainingMs != null && remainingMs > 0 && remainingMs <= WARN_MS;

  const bump = useCallback(async () => {
    if (!user || extending.current || loggingOut.current) return;
    const t = Date.now();
    if (t - lastExtendAt.current < EXTEND_THROTTLE_MS) return;
    lastExtendAt.current = t;
    extending.current = true;
    try {
      await extendSession();
    } catch {
      if (!loggingOut.current) await logout();
    } finally {
      extending.current = false;
    }
  }, [user, extendSession, logout]);

  useEffect(() => {
    if (!user) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [user]);

  useEffect(() => {
    if (!user) {
      loggingOut.current = false;
      return;
    }
    if (remainingMs == null) return;
    if (remainingMs <= 0 && !loggingOut.current) {
      loggingOut.current = true;
      void logout();
    }
  }, [user, remainingMs, logout]);

  useEffect(() => {
    if (!user) return;
    const onActivity = (e: Event) => {
      const el = e.target as HTMLElement | null;
      if (el?.closest("[data-session-idle]")) return;
      void bump();
    };
    window.addEventListener("pointerdown", onActivity, true);
    window.addEventListener("keydown", onActivity, true);
    window.addEventListener("wheel", onActivity, { capture: true, passive: true });
    return () => {
      window.removeEventListener("pointerdown", onActivity, true);
      window.removeEventListener("keydown", onActivity, true);
      window.removeEventListener("wheel", onActivity, true);
    };
  }, [user, bump]);

  if (!showWarn || remainingMs == null) return null;

  const remainMin = Math.max(1, Math.ceil(remainingMs / 60000));

  return (
    <div
      className="fixed inset-0 z-[90] grid place-items-center bg-black/40 px-4"
      data-session-idle
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="session-idle-title"
    >
      <div className="w-full max-w-[360px] rounded-2xl bg-white px-5 py-5 shadow-[var(--shadow-card)] ring-1 ring-[#e5e7eb]">
        <h2
          id="session-idle-title"
          className="text-center text-[16px] font-semibold text-[#111827]"
        >
          로그인 시간이 곧 만료됩니다
        </h2>
        <p className="mt-3 text-center text-[13px] leading-relaxed text-[#4b5563]">
          약 {remainMin}분 동안 조작이 없으면 자동 로그아웃됩니다.
          계속 이용하려면 연장해 주세요.
        </p>
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={() => {
              loggingOut.current = true;
              void logout();
            }}
            className="flex-1 rounded-xl border border-[#e5e7eb] px-3 py-2.5 text-[13px] font-semibold text-[#4b5563] hover:bg-[#f9fafb]"
          >
            로그아웃
          </button>
          <button
            type="button"
            onClick={() => void bump()}
            className="flex-1 rounded-xl bg-[#2563eb] px-3 py-2.5 text-[13px] font-semibold text-white hover:bg-[#1d4ed8]"
          >
            시간 연장
          </button>
        </div>
      </div>
    </div>
  );
}
