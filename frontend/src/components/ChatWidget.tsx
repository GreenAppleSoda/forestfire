"use client";

import { readApiJson } from "@/lib/apiJson";
import { useAuth } from "@/lib/authContext";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

type ChatMsg = {
  role: "user" | "assistant";
  text: string;
  pdf?: { downloadPath: string; filename: string; pageCount?: number } | null;
  /** 인삿말 등 클라이언트 전용 (서버 히스토리와 구분) */
  local?: boolean;
  at?: number;
};

const SESSION_KEY = "ff_chat_session_id";
const LOGO_SRC = "/logo-chatbot-circle.png";
const GREEN = "#166534";
const PANEL_W = 352; // 22rem
const PANEL_H = 512; // 32rem
const FAB_SIZE = 56;
const EDGE = 20;

function getSessionId(): string {
  if (typeof window === "undefined") return "";
  let id = window.localStorage.getItem(SESSION_KEY);
  if (!id) {
    id = crypto.randomUUID();
    window.localStorage.setItem(SESSION_KEY, id);
  }
  return id;
}

function setSessionId(id: string) {
  if (typeof window === "undefined" || !id) return;
  window.localStorage.setItem(SESSION_KEY, id);
}

function formatTime(at?: number): string {
  const d = new Date(at ?? Date.now());
  const h = d.getHours();
  const m = d.getMinutes();
  const ap = h < 12 ? "오전" : "오후";
  const hh = h % 12 || 12;
  return `${ap} ${hh}:${String(m).padStart(2, "0")}`;
}

function defaultPanelPos(): { left: number; top: number } {
  if (typeof window === "undefined") return { left: 0, top: 0 };
  return {
    left: Math.max(EDGE, window.innerWidth - PANEL_W - EDGE),
    top: Math.max(EDGE, window.innerHeight - PANEL_H - FAB_SIZE - EDGE - 12),
  };
}

function clampPos(left: number, top: number): { left: number; top: number } {
  if (typeof window === "undefined") return { left, top };
  const maxL = Math.max(EDGE, window.innerWidth - PANEL_W - EDGE);
  const maxT = Math.max(EDGE, window.innerHeight - PANEL_H - EDGE);
  return {
    left: Math.min(Math.max(EDGE, left), maxL),
    top: Math.min(Math.max(EDGE, top), maxT),
  };
}

function buildGreeting(displayName: string | null): ChatMsg {
  const hello = displayName ? `${displayName}님, 안녕하세요!` : "안녕하세요!";
  return {
    role: "assistant",
    local: true,
    at: Date.now(),
    text:
      `${hello} 산불맵 안내 챗봇입니다.\n` +
      `지역 산불 위험도나 PDF 보고서가 필요하시면 말씀해 주세요.\n` +
      `예) 오늘 강릉 산불 위험도 어때?`,
  };
}

function LogoMark({ size = 36 }: { size?: number }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={LOGO_SRC}
      alt=""
      width={size}
      height={size}
      className="shrink-0 rounded-full object-cover"
      style={{ width: size, height: size }}
    />
  );
}

function SendIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M3.4 20.4 21 12 3.4 3.6 3 10.2 15 12 3 13.8l.4 6.6Z"
        fill="currentColor"
      />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 12a8 8 0 0 1 13.66-5.66M20 12a8 8 0 0 1-13.66 5.66"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M17 2v5h-5M7 22v-5h5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 3 5 6v5c0 5 3.2 8.4 7 9.8 3.8-1.4 7-4.8 7-9.8V6l-7-3Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="m9 12 2 2 4-4"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** 전 페이지 공통 플로팅 안내 챗봇. 게스트·로그인 모두 이용 가능. */
export function ChatWidget() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [loading, setLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevUserId = useRef<number | null | undefined>(undefined);
  const dragOffset = useRef({ x: 0, y: 0 });

  const displayName = user ? user.nickname || user.name : null;
  const memberLabel = user ? "회원" : "게스트";

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, open, loading]);

  useEffect(() => {
    const uid = user?.id ?? null;
    if (prevUserId.current === undefined) {
      prevUserId.current = uid;
      return;
    }
    if (prevUserId.current === uid) return;
    prevUserId.current = uid;
    setHistoryLoaded(false);
    setMessages(open ? [buildGreeting(displayName)] : []);
    setError(null);
  }, [user?.id, displayName, open]);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: PointerEvent) => {
      setPos(
        clampPos(e.clientX - dragOffset.current.x, e.clientY - dragOffset.current.y),
      );
    };
    const onUp = () => setDragging(false);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [dragging]);

  const openChat = () => {
    setPos((p) => p ?? defaultPanelPos());
    setOpen(true);
    setMessages((prev) => {
      if (prev.length > 0) return prev;
      return [buildGreeting(displayName)];
    });
  };

  const onHeaderPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("button")) return;
    const origin = pos ?? defaultPanelPos();
    if (!pos) setPos(origin);
    dragOffset.current = { x: e.clientX - origin.left, y: e.clientY - origin.top };
    setDragging(true);
  };

  const loadPrevious = async () => {
    if (historyLoading || historyLoaded) return;
    setHistoryLoading(true);
    setError(null);
    try {
      const sid = getSessionId();
      const q = `?sessionId=${encodeURIComponent(sid)}`;
      const res = await fetch(`/api/chat/history${q}`, {
        credentials: "include",
      });
      const json = await readApiJson<{
        ok?: boolean;
        sessionId?: string | null;
        error?: string;
        messages?: { role: "user" | "assistant"; text: string }[];
      }>(res);
      if (!res.ok || !json.ok) {
        throw new Error(json.error || "이전 대화를 불러오지 못했습니다.");
      }
      if (json.sessionId) setSessionId(json.sessionId);
      const restored = (json.messages || []).map((m) => ({
        role: m.role,
        text: m.text,
        at: Date.now(),
      }));
      setHistoryLoaded(true);
      if (restored.length === 0) {
        setError("이전 대화내역이 없습니다.");
        return;
      }
      setMessages((prev) => {
        const current = prev.filter((m) => !m.local);
        return [...restored, ...current];
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setHistoryLoading(false);
    }
  };

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput("");
    setError(null);
    setMessages((prev) => [...prev, { role: "user", text, at: Date.now() }]);
    setLoading(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, sessionId: getSessionId() }),
      });
      const json = await readApiJson<{
        ok?: boolean;
        answer?: string;
        error?: string;
        sessionId?: string;
        pdf?: { downloadPath: string; filename: string; pageCount?: number } | null;
      }>(res);
      if (json.sessionId) setSessionId(json.sessionId);
      if (!res.ok || !json.ok || !json.answer) {
        throw new Error(json.error || "챗봇 응답에 실패했습니다.");
      }
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          text: json.answer as string,
          pdf: json.pdf ?? null,
          at: Date.now(),
        },
      ]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const panelPos = pos ?? defaultPanelPos();

  return (
    <>
      {open && (
        <div
          className="pointer-events-auto fixed z-[60] flex h-[32rem] w-[22rem] flex-col overflow-hidden rounded-[1.25rem] bg-white shadow-[0_12px_40px_rgba(15,23,42,0.18)] ring-1 ring-[#e5e7eb]"
          style={{ left: panelPos.left, top: panelPos.top }}
        >
          {/* Header: 로고 + 닉네임·회원 뱃지 · 드래그 · X */}
          <div
            className={`flex items-center gap-2.5 border-b border-[#eceff3] px-3.5 py-3 select-none ${
              dragging ? "cursor-grabbing" : "cursor-grab"
            }`}
            onPointerDown={onHeaderPointerDown}
          >
            <LogoMark size={40} />
            <div className="flex min-w-0 flex-1 items-center gap-1.5">
              <p className="truncate text-[13px] font-semibold leading-none text-[#111827]">
                {displayName || "방문자"}
              </p>
              <span
                className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium leading-none ${
                  user
                    ? "bg-[#dcfce7] text-[#166534]"
                    : "bg-[#f3f4f6] text-[#6b7280]"
                }`}
              >
                {memberLabel}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-full text-[18px] leading-none text-[#9ca3af] hover:bg-[#f3f4f6] hover:text-[#4b5563]"
              aria-label="닫기"
            >
              ×
            </button>
          </div>

          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-3.5 py-3">
            {!historyLoaded && (
              <div className="flex items-center gap-2 py-1">
                <div className="h-px flex-1 bg-[#e5e7eb]" />
                <button
                  type="button"
                  onClick={() => void loadPrevious()}
                  disabled={historyLoading}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium text-[#166534] hover:bg-[#ecfdf5] disabled:opacity-60"
                >
                  <RefreshIcon />
                  {historyLoading ? "불러오는 중…" : "이전 대화내역 불러오기"}
                </button>
                <div className="h-px flex-1 bg-[#e5e7eb]" />
              </div>
            )}

            {messages.map((m, i) => {
              const isUser = m.role === "user";
              return (
                <div
                  key={i}
                  className={`flex gap-2 ${isUser ? "flex-row-reverse" : "flex-row"}`}
                >
                  {!isUser && (
                    <div className="mt-0.5 shrink-0">
                      <LogoMark size={28} />
                    </div>
                  )}
                  <div
                    className={`max-w-[78%] ${isUser ? "items-end" : "items-start"} flex flex-col`}
                  >
                    <div
                      className={`whitespace-pre-wrap px-3 py-2 text-[12.5px] leading-relaxed ${
                        isUser
                          ? "rounded-2xl rounded-tr-md bg-[#111827] text-white"
                          : "rounded-2xl rounded-tl-md bg-[#f3f4f6] text-[#111827]"
                      }`}
                    >
                      {m.text}
                    </div>
                    {m.pdf?.downloadPath ? (
                      <a
                        href={m.pdf.downloadPath}
                        className="mt-1.5 inline-flex rounded-lg px-2.5 py-1.5 text-[11px] font-medium text-white hover:opacity-90"
                        style={{ backgroundColor: GREEN }}
                      >
                        PDF 다운로드
                        {m.pdf.pageCount ? ` (${m.pdf.pageCount}p)` : ""}
                      </a>
                    ) : null}
                    <span className="mt-1 text-[10px] text-[#9ca3af]">{formatTime(m.at)}</span>
                  </div>
                </div>
              );
            })}

            {loading && (
              <div className="flex gap-2">
                <LogoMark size={28} />
                <div className="rounded-2xl rounded-tl-md bg-[#f3f4f6] px-3 py-2 text-[12px] text-[#6b7280]">
                  답변 작성 중…
                </div>
              </div>
            )}
            {error && <p className="text-center text-[11px] text-[#e03131]">{error}</p>}
          </div>

          <div className="border-t border-[#eceff3] px-3 pb-2.5 pt-2.5">
            <form
              className="flex items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void send();
              }}
            >
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="질문을 입력하세요…"
                className="min-w-0 flex-1 rounded-full border border-[#e5e7eb] bg-[#fafafa] px-3.5 py-2.5 text-[12.5px] text-[#111827] outline-none placeholder:text-[#9ca3af] focus:border-[#86efac] focus:bg-white"
              />
              <button
                type="submit"
                disabled={loading || !input.trim()}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white disabled:opacity-40"
                style={{ backgroundColor: GREEN }}
                aria-label="전송"
              >
                <SendIcon />
              </button>
            </form>
            <p className="mt-2 flex items-center justify-center gap-1 text-[9.5px] leading-snug text-[#9ca3af]">
              <span className="text-[#6b7280]">
                <ShieldIcon />
              </span>
              본 챗봇은 산불맵 서비스 이용을 위한 자동 응답 시스템입니다.
            </p>
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => {
          if (open) setOpen(false);
          else openChat();
        }}
        className="pointer-events-auto fixed bottom-5 right-5 z-[60] flex h-14 w-14 items-center justify-center overflow-hidden rounded-full bg-white shadow-[0_8px_24px_rgba(15,23,42,0.18)] ring-1 ring-[#e5e7eb] transition hover:scale-[1.03]"
        aria-label={open ? "챗봇 닫기" : "챗봇 열기"}
      >
        <LogoMark size={52} />
      </button>
    </>
  );
}
