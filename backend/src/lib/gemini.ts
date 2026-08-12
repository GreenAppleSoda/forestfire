/**
 * Google Gemini 클라이언트 (안내 챗봇).
 * GEMINI_API_KEY 미설정이면 getGeminiClient() === null → /api/chat 가 503.
 */
import { GoogleGenAI } from "@google/genai";
import { GEMINI_API_KEY, GEMINI_MODEL } from "../config.js";

export const DEFAULT_MODEL = GEMINI_MODEL;

let client: GoogleGenAI | null | undefined;

export function getGeminiClient(): GoogleGenAI | null {
  if (client !== undefined) return client;
  if (!GEMINI_API_KEY) {
    client = null;
    return client;
  }
  client = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
  return client;
}
