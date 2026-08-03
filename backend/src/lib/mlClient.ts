import { ML_SERVICE_URL } from "../config.js";
import type { FlaskJson, JsonObject } from "../types.js";

type FlaskResponse = { status: number; json: FlaskJson };

async function postJson(
  url: string,
  body: unknown,
  timeoutMs: number,
): Promise<FlaskResponse> {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const json = (await r.json().catch(() => ({}))) as FlaskJson;
  return { status: r.status, json };
}

export async function callFlaskPredict(
  body: JsonObject,
): Promise<FlaskResponse> {
  return postJson(`${ML_SERVICE_URL}/predict/daily`, body, 120_000);
}

export async function callFlaskScenario(
  body: JsonObject,
): Promise<FlaskResponse> {
  return postJson(`${ML_SERVICE_URL}/predict/scenario`, body, 120_000);
}

export async function callFlaskHealth(): Promise<FlaskJson> {
  const r = await fetch(`${ML_SERVICE_URL}/health`, {
    signal: AbortSignal.timeout(3000),
  });
  return (await r.json()) as FlaskJson;
}

export async function callFlaskWildfireSyncStatus(): Promise<{
  ok: boolean;
  status: number;
  json: FlaskJson;
}> {
  const r = await fetch(`${ML_SERVICE_URL}/sync/wildfires/status`, {
    signal: AbortSignal.timeout(10_000),
  });
  const json = (await r.json().catch(() => ({}))) as FlaskJson;
  return { ok: r.ok, status: r.status, json };
}

export async function callFlaskWildfireSync(
  body: JsonObject,
): Promise<{ ok: boolean; status: number; json: FlaskJson }> {
  const r = await fetch(`${ML_SERVICE_URL}/sync/wildfires`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(180_000),
  });
  const json = (await r.json().catch(() => ({}))) as FlaskJson;
  return { ok: r.ok, status: r.status, json };
}
