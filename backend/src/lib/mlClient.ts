import { ML_SERVICE_URL } from "../config.js";
import type { FlaskJson, JsonObject } from "../types.js";

type FlaskResponse = { status: number; json: FlaskJson };

async function postJson(
  url: string,
  body: unknown,
  timeoutMs: number,
): Promise<FlaskResponse> {
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await r.text();
    let json: FlaskJson = {};
    try {
      json = JSON.parse(text) as FlaskJson;
    } catch {
      json = {
        ok: false,
        error: "ml_service_non_json",
        detail: text.slice(0, 200),
      };
    }
    return { status: r.status, json };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      status: 502,
      json: { ok: false, error: "ml_service_unreachable", detail: msg },
    };
  }
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

async function getJson(url: string, timeoutMs: number): Promise<FlaskResponse> {
  try {
    const r = await fetch(url, {
      method: "GET",
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await r.text();
    let json: FlaskJson = {};
    try {
      json = JSON.parse(text) as FlaskJson;
    } catch {
      json = {
        ok: false,
        error: "ml_service_non_json",
        detail: text.slice(0, 200),
      };
    }
    return { status: r.status, json };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      status: 502,
      json: { ok: false, error: "ml_service_unreachable", detail: msg },
    };
  }
}

export async function callFlaskScenarioBaseline(
  month: number,
): Promise<FlaskResponse> {
  return getJson(
    `${ML_SERVICE_URL}/predict/scenario/baseline?month=${month}`,
    90_000,
  );
}

export type FlaskReportPdfResult =
  | { ok: true; status: number; buffer: Buffer; filename: string; regionLabel: string }
  | { ok: false; status: number; json: FlaskJson };

/** ml-service의 POST /report/pdf 호출. 성공 시 PDF 바이너리, 실패 시 JSON 에러. */
export async function callFlaskReportPdf(
  body: JsonObject,
): Promise<FlaskReportPdfResult> {
  try {
    const r = await fetch(`${ML_SERVICE_URL}/report/pdf`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
    const contentType = r.headers.get("content-type") || "";
    if (r.ok && contentType.includes("application/pdf")) {
      const buffer = Buffer.from(await r.arrayBuffer());
      const filenameHeader = r.headers.get("x-report-filename");
      const regionHeader = r.headers.get("x-report-region");
      return {
        ok: true,
        status: r.status,
        buffer,
        filename: filenameHeader ? decodeURIComponent(filenameHeader) : "report.pdf",
        regionLabel: regionHeader ? decodeURIComponent(regionHeader) : "",
      };
    }
    const text = await r.text();
    let json: FlaskJson = {};
    try {
      json = JSON.parse(text) as FlaskJson;
    } catch {
      json = { ok: false, error: "ml_service_non_json", detail: text.slice(0, 200) };
    }
    return { ok: false, status: r.status, json };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      status: 502,
      json: { ok: false, error: "ml_service_unreachable", detail: msg },
    };
  }
}

export async function callFlaskHealth(): Promise<FlaskJson> {
  const r = await fetch(`${ML_SERVICE_URL}/health`, {
    signal: AbortSignal.timeout(3000),
  });
  return (await r.json()) as FlaskJson;
}
