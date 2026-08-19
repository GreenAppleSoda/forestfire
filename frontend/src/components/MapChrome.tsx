"use client";

import type { MapDisplayMode } from "@/lib/types";
import { useAuth } from "@/lib/authContext";
import { useState } from "react";
import { ReportModal } from "./ReportModal";

type Props = {
  mapMode: MapDisplayMode;
  onMapMode: (mode: MapDisplayMode) => void;
  onLogin: () => void;
  onRegister: () => void;
};

export function MapChrome({ mapMode, onMapMode, onLogin, onRegister }: Props) {
  const { user, loading, logout } = useAuth();
  const isGeneral = mapMode === "choropleth";
  const [reportOpen, setReportOpen] = useState(false);

  return (
    <>
      <div className="pointer-events-auto flex items-center gap-4">
        <div className="flex items-center gap-1.5">
          <div className="flex overflow-hidden rounded-lg bg-white shadow-[var(--shadow-card)] ring-1 ring-[#e5e7eb]">
            <button
              type="button"
              onClick={() => onMapMode("choropleth")}
              className={`px-3.5 py-2 text-[12px] font-semibold transition ${
                isGeneral
                  ? "bg-[#2563eb] text-white"
                  : "bg-white text-[#111827] hover:bg-[#f8fafc]"
              }`}
            >
              일반
            </button>
            <button
              type="button"
              onClick={() => onMapMode("satellite")}
              className={`px-3.5 py-2 text-[12px] font-semibold transition ${
                !isGeneral
                  ? "bg-[#2563eb] text-white"
                  : "bg-white text-[#111827] hover:bg-[#f8fafc]"
              }`}
            >
              위성
            </button>
          </div>
          {user ? (
            <button
              type="button"
              onClick={() => setReportOpen(true)}
              className="rounded-lg bg-white px-3 py-2 text-[12px] font-semibold text-[#111827] shadow-[var(--shadow-card)] ring-1 ring-[#e5e7eb] transition hover:bg-[#f8fafc]"
            >
              보고서
            </button>
          ) : null}
        </div>

        {loading ? (
          <span className="px-2 text-[12px] text-[#9ca3af]">…</span>
        ) : user ? (
          <div className="flex items-center gap-1.5">
            <span className="inline-flex max-w-[128px] items-center gap-1.5 rounded-lg bg-white px-2.5 py-2 text-[12px] font-medium text-[#111827] shadow-[var(--shadow-card)] ring-1 ring-[#e5e7eb]">
              <svg
                viewBox="0 0 24 24"
                className="h-3.5 w-3.5 shrink-0 text-[#6b7280]"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                aria-hidden
              >
                <circle cx="12" cy="8" r="3.2" />
                <path d="M5.5 18.2c.8-2.6 3.1-4.2 6.5-4.2s5.7 1.6 6.5 4.2" strokeLinecap="round" />
              </svg>
              <span className="truncate">{user.nickname || user.name}</span>
            </span>
            <button
              type="button"
              onClick={() => void logout()}
              className="rounded-lg bg-white px-2.5 py-2 text-[12px] text-[#6b7280] shadow-[var(--shadow-card)] ring-1 ring-[#e5e7eb] transition hover:bg-[#f9fafb] hover:text-[#111827]"
            >
              로그아웃
            </button>
          </div>
        ) : (
          <div className="flex overflow-hidden rounded-lg shadow-[var(--shadow-card)] ring-1 ring-[#e5e7eb]">
            <button
              type="button"
              onClick={onLogin}
              className="bg-[#111827] px-3 py-2 text-[12px] font-semibold text-white transition hover:bg-[#1f2937]"
            >
              로그인
            </button>
            <button
              type="button"
              onClick={onRegister}
              className="bg-white px-3 py-2 text-[12px] font-semibold text-[#111827] transition hover:bg-[#f8fafc]"
            >
              회원가입
            </button>
          </div>
        )}
      </div>

      <ReportModal open={reportOpen} onClose={() => setReportOpen(false)} />
    </>
  );
}
