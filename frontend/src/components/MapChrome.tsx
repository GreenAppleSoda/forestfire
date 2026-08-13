"use client";

import type { MapDisplayMode } from "@/lib/types";
import { useAuth } from "@/lib/authContext";

type Props = {
  mapMode: MapDisplayMode;
  onMapMode: (mode: MapDisplayMode) => void;
  onLogin: () => void;
  onRegister: () => void;
};

export function MapChrome({ mapMode, onMapMode, onLogin, onRegister }: Props) {
  const { user, loading, logout } = useAuth();
  const isGeneral = mapMode === "choropleth";

  return (
    <div className="pointer-events-auto flex items-center gap-2">
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
          위성지도
        </button>
      </div>

      {loading ? (
        <span className="rounded-lg bg-white px-3 py-2 text-[12px] text-[#9ca3af] shadow-[var(--shadow-card)] ring-1 ring-[#e5e7eb]">
          …
        </span>
      ) : user ? (
        <div className="flex items-center gap-1.5">
          <span className="max-w-[96px] truncate rounded-lg bg-white px-3 py-2 text-[12px] font-medium text-[#111827] shadow-[var(--shadow-card)] ring-1 ring-[#e5e7eb]">
            {user.nickname || user.name}
          </span>
          <button
            type="button"
            onClick={() => void logout()}
            className="rounded-lg bg-white px-3 py-2 text-[12px] font-semibold text-[#2563eb] shadow-[var(--shadow-card)] ring-1 ring-[#e5e7eb] transition hover:bg-[#f8fafc]"
          >
            로그아웃
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onLogin}
            className="rounded-lg bg-white px-3 py-2 text-[12px] font-semibold text-[#2563eb] shadow-[var(--shadow-card)] ring-1 ring-[#e5e7eb] transition hover:bg-[#f8fafc]"
          >
            로그인
          </button>
          <button
            type="button"
            onClick={onRegister}
            className="rounded-lg bg-white px-3 py-2 text-[12px] font-semibold text-[#2563eb] shadow-[var(--shadow-card)] ring-1 ring-[#e5e7eb] transition hover:bg-[#f8fafc]"
          >
            회원가입
          </button>
        </div>
      )}
    </div>
  );
}
