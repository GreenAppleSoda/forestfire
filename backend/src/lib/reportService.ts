/**
 * 지역별 산불위험 PDF 리포트 — ml-service(Python/Playwright)에 위임.
 * 예전 pdfkit 기반 buildReportPdf(reportPdf.ts)를 대체한다.
 */
import { callFlaskReportPdf } from "./mlClient.js";

export type ReportCoverMeta = {
  /** 표시용 발행일 (없으면 ml-service 가 생성 시각 사용) */
  issuedAt?: string;
  author?: string;
  nickname?: string;
};

export type ReportPdfResult =
  | { ok: true; buffer: Buffer; filename: string; regionLabel: string }
  | { ok: false; error: string; status: number };

/**
 * region: 시·도명("서울"), 시군구명("노원구"), "시·도 시군구"(동명이인 구분),
 * 또는 빈 문자열/"전국" — 전국 종합 리포트. report.data.resolve_target() 참고.
 */
export async function buildRegionReportPdf(
  region: string,
  cover?: ReportCoverMeta,
): Promise<ReportPdfResult> {
  const result = await callFlaskReportPdf({
    region,
    cover: {
      issuedAt: cover?.issuedAt ?? null,
      author: cover?.author ?? "산불 예측 챗봇 서비스",
      nickname: cover?.nickname ?? "회원",
    },
  });

  if (result.ok) {
    return {
      ok: true,
      buffer: result.buffer,
      filename: result.filename,
      regionLabel: result.regionLabel,
    };
  }

  if (result.json.error === "invalid_region") {
    const detail = typeof result.json.detail === "string" ? result.json.detail : null;
    return { ok: false, error: detail || `'${region}' 지역을 찾을 수 없습니다.`, status: 400 };
  }
  if (result.json.error === "predict_data_missing") {
    return {
      ok: false,
      error: "예측 데이터를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.",
      status: 503,
    };
  }
  console.error("[reportService] ml-service error", result.status, result.json);
  return { ok: false, error: "PDF 생성에 실패했습니다. 잠시 후 다시 시도해 주세요.", status: 502 };
}

export function formatIssuedAtKo(d = new Date()): string {
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  return `${y}년 ${m}월 ${day}일`;
}
