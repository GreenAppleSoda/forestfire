/**
 * 안내 챗봇 API (Google Gemini).
 *
 * 흐름:
 *   1) 세션·메시지 영속화(선택) — 로그인 시 user_id 기준 히스토리 로드
 *   2) 위험 스냅샷: 예측 API 우선 → 실패 시 daily_ml_risk.json 폴백
 *   3) 스냅샷을 시스템 프롬프트에 첨부 후 Gemini 응답
 */
import { randomUUID } from "node:crypto";
import { Router } from "express";
import type { RowDataPacket } from "mysql2";
import { isDbConfigured, getPool } from "../lib/db.js";
import { DEFAULT_MODEL, getGeminiClient } from "../lib/gemini.js";
import { buildRegionReportPdf } from "../lib/reportService.js";
import { putReportPdf } from "../lib/reportStore.js";
import { resolveRegionFocus, wantsPdfReport } from "../lib/regionFocus.js";
import { resolveRiskSnapshot, snapshotToPromptJson } from "../lib/riskSnapshot.js";
import "../types/express.js";

const router = Router();

const SYSTEM_PROMPT_BASE = `당신은 "산불맵(Wildfire Atlas)" 서비스의 안내 챗봇입니다.
대한민국 시군구 단위 산불 발생 위험을 안내합니다.

[데이터 근거 — 필수]
- 산불 위험 정보의 근거는 아래에 첨부된 예측 스냅샷(JSON)입니다.
- data_source 가 realtime_predict_api 이면 방금 조회한 실시간(또는 서버 캐시) 예측입니다.
- data_source 가 cached_file_fallback 이면 기상/예측 API 실패로 저장된 파일 스냅샷입니다. 이 경우 답변에 "캐시 데이터 기준"임을 짧게 알리세요.
- 첨부 데이터에 없는 수치·지역 위험도는 추측하지 마세요.
- 데이터가 없으면 "현재 예측 데이터가 없습니다"라고만 답하세요.

[필드 안내]
- predict_date, observed_at(관측 시각), weather_source, sample_weather
- regions[]: code, name, province, ml_risk, ml_risk_norm, temp_avg, humidity_avg, precip, wind_avg
- ml_risk×100 ≈ 산불위험지수(0~100), ml_risk_norm은 지도용 상대값(0~1)

[이용 안내]
- 비로그인 사용자도 챗봇·지도·당일/시나리오 예측 열람이 가능합니다.
- "보고서 만들어줘" 요청 시 서버가 슬라이드형 PDF를 생성합니다(로그인 회원만). 챗봇은 PDF 안내만 하면 되고 장문 보고서 본문을 채팅에 쓰지 마세요.

[답변 형식 — 필수]
- 사용자에게 보이는 위험도는 "산불위험지수"만 쓰세요. 값은 ml_risk×100을 소수 1자리로 (예: 19.3).
- ml_risk, ml_risk_norm, norm, code 등 내부 필드명·원본 소수값은 답변에 넣지 마세요.
- 마크다운을 쓰지 마세요. **, *, #, \` 금지. 지역명도 굵게 표시하지 마세요.
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
- 마지막에 반드시:
  "더 자세한 지역이 궁금하시면 질문해 주세요. 예시) 충주시의 산불발생 위험도를 알려줘"
- 시군구 단위(예: 충주시, 여수시)로 물으면 그 지역만 답하세요.

답변은 기본적으로 한국어로 간결하게(요청이 없으면 200자 이내), 과장 없이 사실만 쓰세요.
요청이 있으면 그에 맞게 답변하세요.`;

type ChatRole = "user" | "assistant";

const HISTORY_LIMIT_GUEST = 12;
const HISTORY_LIMIT_MEMBER = 24;

/** 세션 확보. 다른 회원 소유 UUID면 새 세션을 발급한다. */
async function ensureSession(sessionId: string, userId: number | null): Promise<string> {
  const pool = getPool();
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT user_id FROM chat_sessions WHERE id = ?",
    [sessionId],
  );

  if (rows.length === 0) {
    await pool.query("INSERT INTO chat_sessions (id, user_id) VALUES (?, ?)", [
      sessionId,
      userId,
    ]);
    return sessionId;
  }

  const row = rows[0];
  if (!row) {
    return sessionId;
  }
  const existing = row.user_id != null ? Number(row.user_id) : null;
  if (userId != null && existing != null && existing !== userId) {
    const fresh = randomUUID();
    await pool.query("INSERT INTO chat_sessions (id, user_id) VALUES (?, ?)", [
      fresh,
      userId,
    ]);
    return fresh;
  }

  if (userId != null && existing == null) {
    await pool.query(
      "UPDATE chat_sessions SET user_id = ? WHERE id = ? AND user_id IS NULL",
      [userId, sessionId],
    );
  }
  return sessionId;
}

/**
 * 로그인 회원: user_id 기준 최근 메시지 (기기·sessionId와 무관).
 * 게스트: 해당 sessionId 만.
 */
async function loadHistory(opts: {
  sessionId: string;
  userId: number | null;
  limit?: number;
}): Promise<{ role: ChatRole; content: string }[]> {
  const pool = getPool();
  const limit =
    opts.limit ??
    (opts.userId != null ? HISTORY_LIMIT_MEMBER : HISTORY_LIMIT_GUEST);

  const [rows] =
    opts.userId != null
      ? await pool.query<RowDataPacket[]>(
          `SELECT m.role, m.content
           FROM chat_messages m
           INNER JOIN chat_sessions s ON s.id = m.session_id
           WHERE s.user_id = ?
           ORDER BY m.id DESC
           LIMIT ?`,
          [opts.userId, limit],
        )
      : await pool.query<RowDataPacket[]>(
          "SELECT role, content FROM chat_messages WHERE session_id = ? ORDER BY id DESC LIMIT ?",
          [opts.sessionId, limit],
        );

  return rows
    .reverse()
    .map((r) => ({ role: r.role as ChatRole, content: String(r.content) }));
}

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
      sessionId = await ensureSession(sessionId, userId);
      history = await loadHistory({ sessionId, userId });
      await saveMessage(sessionId, "user", message);
    }

    const displayName = req.user
      ? req.user.nickname || req.user.name || "회원"
      : null;
    const userContext = displayName
      ? `현재 로그인 사용자: ${displayName}`
      : "현재 비로그인(게스트) 사용자입니다.";

    // PDF 보고서 요청 — 회원만, Gemini 장문 대신 파일 생성
    if (wantsPdfReport(message)) {
      if (!req.user) {
        const answer =
          "보고서는 로그인 회원만 받을 수 있습니다.\n상단에서 로그인·회원가입 후 다시 요청해 주세요.";
        if (dbReady) await saveMessage(sessionId, "assistant", answer);
        return res.json({
          ok: true,
          sessionId,
          answer,
          historyPersisted: dbReady,
          pdf: null,
        });
      }

      const focus = resolveRegionFocus(message);
      const built = await buildRegionReportPdf(focus.label);
      if (!built.ok) {
        const answer = `PDF 보고서를 만들지 못했습니다.\n${built.error}`;
        if (dbReady) await saveMessage(sessionId, "assistant", answer);
        return res.json({
          ok: true,
          sessionId,
          answer,
          historyPersisted: dbReady,
          pdf: null,
        });
      }

      const id = randomUUID();
      putReportPdf(id, built.buffer, built.filename);
      const focusLabel = built.regionLabel || focus.label;
      const answer =
        `${focusLabel} 산불 당일 예측 PDF 보고서를 만들었습니다.\n` +
        `아래 다운로드 버튼으로 받아 주세요.`;
      if (dbReady) await saveMessage(sessionId, "assistant", answer);
      return res.json({
        ok: true,
        sessionId,
        answer,
        historyPersisted: dbReady,
        pdf: {
          id,
          filename: built.filename,
          focusLabel,
          downloadPath: `/api/report/download/${id}`,
        },
      });
    }

    const snap = await resolveRiskSnapshot();
    const systemInstruction = snap
      ? `${SYSTEM_PROMPT_BASE}

[예측 스냅샷]
${snapshotToPromptJson(snap)}`
      : `${SYSTEM_PROMPT_BASE}

[예측 스냅샷]
(데이터 없음 — 실시간 예측·캐시 파일 모두 실패)`;

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

    return res.json({
      ok: true,
      sessionId,
      answer,
      historyPersisted: dbReady,
      dataSource: snap?.source ?? null,
    });
  } catch (e) {
    console.error("[chat]", e);
    return res.status(502).json({
      ok: false,
      error: "챗봇 응답 생성에 실패했습니다. 잠시 후 다시 시도해 주세요.",
    });
  }
});

/** 로그인 회원: 계정 기준 최근 대화 / 게스트: sessionId 기준 */
router.get("/chat/history", async (req, res) => {
  if (!isDbConfigured()) {
    return res.json({ ok: true, messages: [], historyPersisted: false });
  }

  const userId = req.user?.id ?? null;
  let sessionId = String(req.query.sessionId || "").trim();
  if (!userId && !sessionId) {
    return res.json({ ok: true, messages: [], historyPersisted: true });
  }

  try {
    // 로그인 직후: 게스트로 쓰던 sessionId 에 user_id 를 붙여 계정 히스토리에 합침
    if (userId && sessionId) {
      sessionId = await ensureSession(sessionId, userId);
    }

    const messages = await loadHistory({
      sessionId: sessionId || "",
      userId,
    });
    return res.json({
      ok: true,
      sessionId: sessionId || null,
      messages: messages.map((m) => ({ role: m.role, text: m.content })),
      historyPersisted: true,
    });
  } catch (e) {
    console.error("[chat/history]", e);
    return res.status(500).json({ ok: false, error: "대화 기록을 불러오지 못했습니다." });
  }
});

export default router;
