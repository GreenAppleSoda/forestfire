"use client";

import { readApiJson } from "@/lib/apiJson";
import { useAuth } from "@/lib/authContext";
import { useEffect, useRef, useState } from "react";

type ChatMsg = { role: "user" | "assistant"; text: string };

const SESSION_KEY = "ff_chat_session_id";

function getSessionId(): string {
  if (typeof window === "undefined") return "";
  let id = window.localStorage.getItem(SESSION_KEY);
  if (!id) {
    id = crypto.randomUUID();
    window.localStorage.setItem(SESSION_KEY, id);
  }
  return id;
}

/** 전 페이지 공통 플로팅 안내 챗봇. 게스트·로그인 모두 이용 가능. */
export function ChatWidget() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, open]);

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput("");
    setError(null);
    setMessages((prev) => [...prev, { role: "user", text }]);
    setLoading(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, sessionId: getSessionId() }),
      });
      const json = await readApiJson<{ ok?: boolean; answer?: string; error?: string }>(res);
      if (!res.ok || !json.ok || !json.answer) {
        throw new Error(json.error || "챗봇 응답에 실패했습니다.");
      }
      setMessages((prev) => [...prev, { role: "assistant", text: json.answer as string }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const subtitle = user
    ? `${user.nickname || user.name} · ${user.subscriptionTier}`
    : "비로그인 이용 가능";

  return (
    <div className="pointer-events-none fixed bottom-5 right-5 z-[60] flex flex-col items-end gap-2">
      {open && (
        <div className="pointer-events-auto flex h-[28rem] w-80 flex-col overflow-hidden rounded-2xl bg-white shadow-lg ring-1 ring-[#e5e7eb]">
          <div className="flex items-center justify-between border-b border-[#e5e7eb] bg-[#f9fafb] px-3 py-2.5">
            <div>
              <p className="text-[12px] font-semibold text-[#111827]">산불맵 챗봇</p>
              <p className="text-[10px] text-[#6b7280]">{subtitle}</p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-[16px] leading-none text-[#9ca3af] hover:text-[#4b5563]"
              aria-label="닫기"
            >
              ×
            </button>
          </div>

          <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto px-3 py-2.5">
            {messages.length === 0 && (
              <p className="text-[11px] leading-snug text-[#9ca3af]">
                예: &ldquo;오늘 강릉 산불 위험도 어때?&rdquo;, &ldquo;당일 예측은 어떻게
                봐?&rdquo;, &ldquo;PLUS 등급은 뭐가 다른가요?&rdquo;
              </p>
            )}
            {messages.map((m, i) => (
              <div
                key={i}
                className={`max-w-[85%] whitespace-pre-wrap rounded-xl px-2.5 py-1.5 text-[12px] leading-snug ${
                  m.role === "user"
                    ? "ml-auto bg-[#111827] text-white"
                    : "bg-[#f3f4f6] text-[#111827]"
                }`}
              >
                {m.text}
              </div>
            ))}
            {loading && (
              <div className="max-w-[85%] rounded-xl bg-[#f3f4f6] px-2.5 py-1.5 text-[12px] text-[#6b7280]">
                답변 작성 중…
              </div>
            )}
            {error && <p className="text-[11px] text-[#e03131]">{error}</p>}
          </div>

          <form
            className="flex items-center gap-1.5 border-t border-[#e5e7eb] px-2.5 py-2"
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
              className="flex-1 rounded-xl border border-[#e5e7eb] px-2 py-1.5 text-[12px] text-[#111827]"
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="rounded-xl bg-[#111827] px-2.5 py-1.5 text-[11px] font-medium text-white disabled:opacity-40"
            >
              전송
            </button>
          </form>
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="pointer-events-auto flex h-12 w-12 items-center justify-center rounded-full bg-white shadow-lg ring-1 ring-[#e5e7eb] hover:bg-[#f9fafb]"
        aria-label={open ? "챗봇 닫기" : "챗봇 열기"}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/chat-bubble.svg" alt="" width={22} height={22} />
      </button>
    </div>
  );
}
