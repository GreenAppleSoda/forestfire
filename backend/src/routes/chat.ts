/**
 * 안내 챗봇 API (Google Gemini).
 *
 * 흐름 요약:
 *   1) POST /api/chat — 사용자 메시지 수신
 *   2) (선택) MariaDB에 세션·이전 대화 로드 / 이번 질문 저장
 *   3) Gemini generateContent 호출 (시스템 프롬프트 + tools 선언)
 *   4) 모델이 get_wildfire_risk 를 부르면 → 실제 당일 예측 실행 → 결과를 다시 Gemini에 전달
 *   5) 최종 텍스트 답변을 JSON으로 반환 (DB 있으면 assistant 메시지도 저장)
 *
 * 게스트(비로그인) 우선. 인증 연동 시 optionalAuth 가 req.user 를 채우면 이름·등급을 프롬프트에 넣는다.
 * GEMINI_API_KEY 미설정이면 503. DB_* 미설정이면 대화 영속화만 생략.
 */
import { randomUUID } from "node:crypto";
import { Type } from "@google/genai";
import { Router } from "express";
import type { RowDataPacket } from "mysql2";
import { isDbConfigured, getPool } from "../lib/db.js";
import { DEFAULT_MODEL, getGeminiClient } from "../lib/gemini.js";
import { runPredictDaily } from "../lib/predictService.js";
import "../types/express.js";

const router = Router();

/** Gemini systemInstruction — 역할·툴 사용 규칙·답변 톤 */
const SYSTEM_PROMPT = `당신은 "산불맵(Wildfire Atlas)" 서비스의 안내 챗봇입니다.
이 서비스는 대한민국 시군구 단위 산불 발생 위험을 예측하는 시스템입니다.

이용 안내:
- 비로그인 사용자도 챗봇 이용과 산불 위험 지도·당일/시나리오 예측 열람이 가능합니다.
- 회원 구독 등급: BASIC(기본 열람), PLUS(엑셀·PDF 등 다운로드 예정), PREMIUM(정식 보고서 예정).
- 파일 다운로드·정식 보고서 생성 UI는 준비 중입니다. 등급·이용 방법 질문에는 위 안내를 바탕으로 답하세요.

사용자가 특정 지역(시군구)의 오늘 산불 위험도를 물으면 get_wildfire_risk 도구를 사용해
실제 예측값을 조회한 뒤 답하세요. 도구 결과가 없으면 모른다고 답하고 추측하지 마세요.
답변은 한국어로 간결하게, 과장 없이 사실 위주로 하세요.`;

/**
 * Gemini function calling 도구 선언.
 * 모델이 "지역 위험도를 조회해야 한다"고 판단하면 get_wildfire_risk 를 호출하고,
 * 서버가 runTool()로 실제 예측 API를 실행한 뒤 그 결과를 다시 모델에 넘긴다.
 */
const tools = [
  {
    functionDeclarations: [
      {
        name: "get_wildfire_risk",
        description:
          "당일 기상 기준 시군구별 산불 발생 위험 예측값을 조회합니다. 지역명을 지정하면 해당 지역만, 비워두면 위험도 상위 지역을 반환합니다.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            region_query: {
              type: Type.STRING,
              description: "시군구 이름 일부 (예: '강릉', '종로구'). 비워두면 전국 상위 위험 지역.",
            },
          },
        },
      },
    ],
  },
];

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

/** 정규화 위험지수(0~1) → 사람이 읽기 쉬운 단계 라벨 (툴 응답·모델 참고용) */
function riskLabel(norm: unknown): string {
  const n = Number(norm);
  if (!Number.isFinite(n)) return "알 수 없음";
  if (n >= 0.8) return "매우 높음";
  if (n >= 0.6) return "높음";
  if (n >= 0.4) return "보통";
  if (n >= 0.2) return "낮음";
  return "매우 낮음";
}

/** 예측확률 0~1 → 산불위험지수 0~100 (raw×100) */
function formatProbPct(prob: unknown): string {
  const n = Number(prob);
  if (!Number.isFinite(n)) return "-";
  return (n * 100).toFixed(1);
}

/**
 * Gemini가 요청한 도구를 실제로 실행.
 * get_wildfire_risk → Express 예측 서비스(runPredictDaily, 기상청 KMA) →
 * region_query 로 필터 후 위험도 상위 5개만 요약해 반환.
 */
async function runTool(name: string, args: unknown): Promise<unknown> {
  if (name !== "get_wildfire_risk") {
    return { error: "unknown_tool" };
  }
  const result = await runPredictDaily({ source: "kma" });
  if (!result.ok || !result.data) {
    return { error: "예측 데이터를 불러오지 못했습니다." };
  }
  const regions = result.data.regions || [];
  const q = String((args as Record<string, unknown> | undefined)?.region_query || "").trim();
  // 지역명 부분 일치 필터. 비우면 전국(전체 regions)
  const matched = q
    ? regions.filter((r) => String(r.name ?? "").includes(q))
    : regions;
  const sorted = [...matched].sort(
    (a, b) => Number(b.ml_risk_norm ?? 0) - Number(a.ml_risk_norm ?? 0),
  );
  return {
    predict_date: result.data.predict_date,
    matched_count: matched.length,
    top: sorted.slice(0, 5).map((r) => ({
      name: r.name,
      province: r.province,
      // 웹 당일예측과 동일: ml_risk * 100 (산불위험지수)
      ml_risk_pct: formatProbPct(r.ml_risk),
      risk_norm: r.ml_risk_norm,
      risk_label: riskLabel(r.ml_risk_norm),
    })),
  };
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
  // 새 대화: 클라이언트가 sessionId 를 안 주면 여기서 생성 후 응답에 돌려줌
  if (!sessionId) sessionId = randomUUID();

  // DB_* 미설정이어도 챗봇 자체는 동작(대화만 메모리/응답에 존재, 영속화 안 함)
  const dbReady = isDbConfigured();
  const userId = req.user?.id ?? null;

  try {
    let history: { role: ChatRole; content: string }[] = [];
    if (dbReady) {
      await ensureSession(sessionId, userId);
      history = await loadHistory(sessionId);
      await saveMessage(sessionId, "user", message);
    }

    // 모델이 로그인·구독 등급을 알고 안내할 수 있도록 질문 앞에 붙임
    const displayName = req.user
      ? req.user.nickname || req.user.name || "회원"
      : null;
    const userContext = displayName
      ? `현재 로그인 사용자: ${displayName} (구독 ${req.user?.subscriptionTier || "BASIC"}, 권한등급 ${req.user?.grade ?? 3})`
      : "현재 비로그인(게스트) 사용자입니다.";

    // Gemini contents 형식: role 은 "user" | "model".
    // text / functionCall / functionResponse 파트가 섞이므로 Part 타입은 any 로 둔다.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const contents: any[] = [
      ...history.map((h) => ({
        role: (h.role === "assistant" ? "model" : "user") as "user" | "model",
        parts: [{ text: h.content }],
      })),
      { role: "user", parts: [{ text: `${userContext}\n\n사용자 질문: ${message}` }] },
    ];

    // 1차 호출: 바로 답하거나, 도구(functionCall)를 요청할 수 있음
    let response = await client.models.generateContent({
      model: DEFAULT_MODEL,
      contents,
      config: { systemInstruction: SYSTEM_PROMPT, tools },
    });

    /**
     * Tool-calling 루프 (Gemini thinking / thought_signature).
     *
     * 최근 Gemini(Flash 포함)는 functionCall part에 thoughtSignature를 붙인다.
     * 다음 턴에 "모델이 이렇게 툴을 불렀다"고 다시 넣을 때 서명이 빠지면
     * 400 INVALID_ARGUMENT ("Function call is missing a thought_signature...") 가 난다.
     *
     * 채택: 모델 응답의 원본 parts 전체를 그대로 history에 push
     *   (response.candidates[0].content). thoughtSignature·병렬 functionCall이 유지된다.
     *  
     * 대안 (쓰지 않는 방법 — 참고용):
     * 1) functionCall만 재조립: parts: [{ functionCall: call }]
     *    → 서명 누락으로 실패 (이 버그의 원인).
     * 2) ChatSession / chats.create 사용: SDK가 history·서명을 자동 관리.
     *    → 세션을 요청마다 새로 만들고 DB 텍스트 history와 섞기엔 구조가 무거움.
     * 3) tools 제거 / FunctionCallingConfigMode.NONE: 툴 없이 일반 답변만.
     *    → 실제 예측값 조회 불가.
     * 4) 서명 검증이 느슨한 구모델로 고정: 동작해도 기능·정책이 바뀔 수 있음.
     *
     * @see https://ai.google.dev/gemini-api/docs/thought-signatures
     */
    let loopGuard = 0;
    while (response.functionCalls && response.functionCalls.length > 0 && loopGuard < 3) {
      loopGuard += 1;

      const modelContent = response.candidates?.[0]?.content;
      const modelParts = modelContent?.parts;
      if (!modelParts?.length) break;

      // 원본 part 그대로 (functionCall + thoughtSignature 등). 재조립하지 말 것.
      contents.push({
        role: "model",
        parts: modelParts,
      });

      // 모델이 요청한 각 functionCall 을 서버에서 실행 → functionResponse 파트로 묶음
      const functionResponseParts = [];
      for (const part of modelParts) {
        const call = part.functionCall;
        if (!call?.name) continue;
        const toolResult = await runTool(call.name, call.args);
        functionResponseParts.push({
          functionResponse: {
            name: call.name,
            // functionCall.id 가 있으면 동일 id로 매핑 (문서 권장)
            ...(call.id ? { id: call.id } : {}),
            response: { result: toolResult },
          },
        });
      }
      if (functionResponseParts.length === 0) break;

      // 도구 결과는 role "user" 의 functionResponse 로 전달하는 것이 Gemini 관례
      contents.push({
        role: "user",
        parts: functionResponseParts,
      });

      // 도구 결과를 보고 최종 자연어 답변(또는 추가 툴 호출) 생성
      response = await client.models.generateContent({
        model: DEFAULT_MODEL,
        contents,
        config: { systemInstruction: SYSTEM_PROMPT, tools },
      });
    }

    const answer = response.text?.trim() || "죄송해요, 답변을 생성하지 못했습니다.";

    if (dbReady) {
      await saveMessage(sessionId, "assistant", answer);
    }

    // historyPersisted: 프론트가 "이번 턴이 DB에 남았는지" 알 수 있게 함
    return res.json({ ok: true, sessionId, answer, historyPersisted: dbReady });
  } catch (e) {
    // Gemini/예측/DB 오류를 구분하지 않고 502 + 공통 메시지 (상세는 서버 로그)
    console.error("[chat]", e);
    return res.status(502).json({
      ok: false,
      error: "챗봇 응답 생성에 실패했습니다. 잠시 후 다시 시도해 주세요.",
    });
  }
});

export default router;
