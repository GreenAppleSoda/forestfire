/**
 * 안내 챗봇 API (Google Gemini).
 *
 * 흐름 요약:
 *   1) POST /api/chat — 사용자 메시지 수신
 *   2) (선택) MariaDB에 세션·이전 대화 로드 / 이번 질문 저장
 *   3) backend/data/daily_ml_risk.json 을 읽어 시스템 프롬프트에 포함
 *   4) Gemini generateContent 호출 (도구/예측 API 호출 없음 — 스냅샷만으로 답변)
 *   5) 최종 텍스트 답변을 JSON으로 반환 (DB 있으면 assistant 메시지도 저장)
 *
 * 게스트(비로그인) 우선. 인증 연동 시 optionalAuth 가 req.user 를 채우면 이름을 프롬프트에 넣는다.
 * GEMINI_API_KEY 미설정이면 503. DB_* 미설정이면 대화 영속화만 생략.
 */
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { Router } from "express";
import type { RowDataPacket } from "mysql2";
import { DATA_DIR } from "../config.js";
import { isDbConfigured, getPool } from "../lib/db.js";
import { DEFAULT_MODEL, getGeminiClient } from "../lib/gemini.js";
import "../types/express.js";

const router = Router();

/** 당일 예측 스냅샷 — 챗봇 답변의 산불 위험 근거 (ml-service가 backend/data 에도 저장) */
const DAILY_ML_RISK_FILE = path.join(DATA_DIR, "daily_ml_risk.json");

const SYSTEM_PROMPT_BASE = `당신은 "산불맵(Wildfire Atlas)" 서비스의 안내 챗봇입니다.
대한민국 시군구 단위 산불 발생 위험을 안내합니다.

[데이터 근거 — 필수]
- 산불 위험 정보의 근거는 아래에 첨부된 daily_ml_risk.json 내용입니다.
- 첨부 데이터에 없는 수치·지역 위험도는 추측하지 마세요.
- 데이터가 없으면 "현재 예측 데이터가 없습니다"라고만 답하세요.

[필드 안내]
- predict_date, observed_at(관측 시각), weather_source, sample_weather
- regions[]: code, name, province, ml_risk, ml_risk_norm, temp_avg, humidity_avg, precip, wind_avg
- ml_risk×100 ≈ 산불위험지수(0~100), ml_risk_norm은 지도용 상대값(0~1)

[이용 안내]
- 비로그인 사용자도 챗봇·지도·당일/시나리오 예측 열람이 가능합니다.
- 보고서는 로그인 회원만 이용할 수 있습니다 (준비 중).

[답변 형식 — 필수]
- 사용자에게 보이는 위험도는 "산불위험지수"만 쓰세요. 값은 ml_risk×100을 소수 1자리로 (예: 19.3).
- ml_risk, ml_risk_norm, norm, code 등 내부 필드명·원본 소수값은 답변에 넣지 마세요.
  금지 예: "(ml_risk: 0.19341, norm: 0.2298)"
- 마크다운을 쓰지 마세요. **, *, #, \` 금지. 지역명도 굵게(**이름**) 표시하지 마세요.
- 줄바꿈을 사용하세요. 한 문단으로 길게 이어 쓰지 마세요.
  · 첫 줄: 날짜·지역 요약
  · 그다음 줄: 핵심 수치(평균 또는 해당 시군구)
  · 필요 시 한두 줄 보완
  · 마지막 줄: 안내/후속 질문
- 권장 예(시군구): "여수시: 산불위험지수 약 64.1"

[광역(시도·권역) 질문]
- "충북", "전라도", "대구"처럼 시군구가 여러 개인 단위로 물으면 해당 시군구를 모두 나열하지 마세요.
- 먼저 해당 범위 산불위험지수 평균(소수 1자리)을 말하세요.
- 이어서 위험도가 가장 높은 시군구 이름 1~2개만 짧게 언급해도 됩니다(전체 목록 금지).
- 마지막에 반드시 다음 안내를 넣으세요:
  "더 자세한 지역이 궁금하시면 질문해 주세요. 예시) 충주시의 산불발생 위험도를 알려줘"
- 시군구 단위(예: 충주시, 여수시)로 물으면 그 지역만 답하세요.

답변은 기본적으로 한국어로 간결하게(요청이 없으면 200자 이내), 과장 없이 사실만 쓰세요.
요청이 있으면 그에 맞게 답변하세요.`;

/** DB chat_messages.role 과 동일. Gemini contents 에서는 assistant → "model" 로 변환 */
type ChatRole = "user" | "assistant";

/**
 * 대화 세션 행 보장.
 * - INSERT IGNORE: 같은 sessionId 가 이미 있으면 무시
 * - 게스트로 만든 세션에 나중에 로그인하면 user_id 를 채워 귀속
 */
async function ensureSession(sessionId: string, userId: number | null): Promise<void> {
  const pool = getPool();
  await pool.query("INSERT IGNORE INTO chat_sessions (id, user_id) VALUES (?, ?)", [
    sessionId,
    userId,
  ]);
  if (userId) {
    await pool.query(
      "UPDATE chat_sessions SET user_id = ? WHERE id = ? AND user_id IS NULL",
      [userId, sessionId],
    );
  }
}

/**
 * 최근 메시지 로드 (기본 12개).
 * DB는 최신순(DESC)으로 가져온 뒤 reverse 해서 시간순(오래된→최신)으로 Gemini에 넣는다.
 */
async function loadHistory(
  sessionId: string,
  limit = 12,
): Promise<{ role: ChatRole; content: string }[]> {
  const pool = getPool();
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT role, content FROM chat_messages WHERE session_id = ? ORDER BY id DESC LIMIT ?",
    [sessionId, limit],
  );
  return rows
    .reverse()
    .map((r) => ({ role: r.role as ChatRole, content: String(r.content) }));
}

/** 한 턴(user 또는 assistant) 메시지를 chat_messages 에 저장 */
async function saveMessage(
  sessionId: string,
  role: ChatRole,
  content: string,
): Promise<void> {
  const pool = getPool();
  await pool.query(
    "INSERT INTO chat_messages (session_id, role, content) VALUES (?, ?, ?)",
    [sessionId, role, content],
  );
}

/** daily_ml_risk.json 원문 로드. 없거나 읽기 실패 시 null */
async function loadDailyMlRiskText(): Promise<string | null> {
  try {
    return await fs.readFile(DAILY_ML_RISK_FILE, "utf-8");
  } catch {
    return null;
  }
}

/**
 * POST /api/chat
 * body: { message: string, sessionId?: string }
 * 응답: { ok, sessionId, answer, historyPersisted }
 *
 * sessionId 는 프론트(localStorage)가 이어 보내면 같은 대화로 유지되고,
 * 없으면 서버가 UUID를 새로 발급한다.
 */
router.post("/chat", async (req, res) => {
  const client = getGeminiClient();
  if (!client) {
    return res.status(503).json({
      ok: false,
      error: "챗봇이 아직 설정되지 않았습니다. 관리자에게 문의해 주세요. (GEMINI_API_KEY 미설정)",
    });
  }

  const message = String(req.body?.message || "").trim();
  let sessionId = String(req.body?.sessionId || "").trim();
  if (!message) {
    return res.status(400).json({ ok: false, error: "메시지를 입력해 주세요." });
  }
  if (message.length > 2000) {
    return res.status(400).json({ ok: false, error: "메시지가 너무 깁니다 (2000자 이하)." });
  }
  if (!sessionId) sessionId = randomUUID();

  const dbReady = isDbConfigured();
  const userId = req.user?.id ?? null;

  try {
    let history: { role: ChatRole; content: string }[] = [];
    if (dbReady) {
      await ensureSession(sessionId, userId);
      history = await loadHistory(sessionId);
      await saveMessage(sessionId, "user", message);
    }

    const displayName = req.user
      ? req.user.nickname || req.user.name || "회원"
      : null;
    const userContext = displayName
      ? `현재 로그인 사용자: ${displayName}`
      : "현재 비로그인(게스트) 사용자입니다.";

    const riskJson = await loadDailyMlRiskText();
    const systemInstruction = riskJson
      ? `${SYSTEM_PROMPT_BASE}

[daily_ml_risk.json]
${riskJson}`
      : `${SYSTEM_PROMPT_BASE}

[daily_ml_risk.json]
(파일 없음 — 당일 예측 데이터 없음)`;

    const contents = [
      ...history.map((h) => ({
        role: (h.role === "assistant" ? "model" : "user") as "user" | "model",
        parts: [{ text: h.content }],
      })),
      {
        role: "user" as const,
        parts: [{ text: `${userContext}\n\n사용자 질문: ${message}` }],
      },
    ];

    const response = await client.models.generateContent({
      model: DEFAULT_MODEL,
      contents,
      config: { systemInstruction },
    });

    const answer = response.text?.trim() || "죄송해요, 답변을 생성하지 못했습니다.";

    if (dbReady) {
      await saveMessage(sessionId, "assistant", answer);
    }

    return res.json({ ok: true, sessionId, answer, historyPersisted: dbReady });
  } catch (e) {
    console.error("[chat]", e);
    return res.status(502).json({
      ok: false,
      error: "챗봇 응답 생성에 실패했습니다. 잠시 후 다시 시도해 주세요.",
    });
  }
});

export default router;
