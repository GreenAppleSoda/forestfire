"use client";

import { readApiJson } from "@/lib/apiJson";
import { useEffect, useState } from "react";

type ReportRow = {
  name: string;
  province: string;
  riskIndex: number | null;
};

type DailyReport = {
  title: string;
  generatedAt: string;
  member: { name: string; nickname: string; loginId: string; email: string };
  predictDate: unknown;
  observedAt: unknown;
  weatherSource: string;
  sampleWeather: {
    temp_avg: number | null;
    precip: number | null;
    wind_avg: number | null;
    humidity_avg: number | null;
  };
  note: string;
  summary: {
    regionCount: number;
    averageRiskIndex: number | null;
    highest: ReportRow | null;
    lowest: ReportRow | null;
  };
  topHigh: ReportRow[];
  topLow: ReportRow[];
  sourceLabel: string;
};

type Props = {
  open: boolean;
  onClose: () => void;
};

function fmt(v: unknown): string {
  if (v == null || v === "") return "—";
  return String(v);
}

function fmtNum(v: number | null | undefined, unit = ""): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v}${unit}`;
}

/** 회원 전용 당일 위험 요약 보고서 (모달 표시, DB 저장 없음) */
export function ReportModal({ open, onClose }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<DailyReport | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);

  const downloadPdf = async () => {
    setPdfBusy(true);
    setPdfError(null);
    try {
      const res = await fetch("/api/report/pdf", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ regionQuery: "" }),
      });
      const json = await readApiJson<{
        ok?: boolean;
        error?: string;
        downloadPath?: string;
        filename?: string;
      }>(res);
      if (!res.ok || !json.ok || !json.downloadPath) {
        throw new Error(json.error || "PDF 생성에 실패했습니다.");
      }
      const fileRes = await fetch(json.downloadPath, { credentials: "include" });
      if (!fileRes.ok) {
        throw new Error("PDF 다운로드에 실패했습니다.");
      }
      const blob = await fileRes.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = json.filename || "report.pdf";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setPdfError(e instanceof Error ? e.message : String(e));
    } finally {
      setPdfBusy(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setReport(null);
    void (async () => {
      try {
        const res = await fetch("/api/report/daily", { credentials: "include" });
        const json = await readApiJson<{
          ok?: boolean;
          error?: string;
          report?: DailyReport;
        }>(res);
        if (!res.ok || !json.ok || !json.report) {
          throw new Error(json.error || "보고서를 불러오지 못했습니다.");
        }
        if (!cancelled) setReport(json.report);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-black/40"
        aria-label="닫기"
        onClick={onClose}
      />
      <div className="relative flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-xl ring-1 ring-[#e5e7eb]">
        <div className="flex items-start justify-between border-b border-[#e5e7eb] px-4 py-3">
          <div>
            <p className="text-[14px] font-semibold text-[#111827]">
              {report?.title || "당일 위험 요약 보고서"}
            </p>
            <p className="mt-0.5 text-[11px] text-[#6b7280]">회원 전용</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-[18px] leading-none text-[#9ca3af] hover:text-[#4b5563]"
            aria-label="닫기"
          >
            ×
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 text-[12px] text-[#111827]">
          {loading && <p className="text-[#6b7280]">보고서 생성 중…</p>}
          {error && <p className="text-[#e03131]">{error}</p>}
          {report && (
            <div className="space-y-4">
              <section className="space-y-1 rounded-xl bg-[#f9fafb] px-3 py-2.5 ring-1 ring-[#e5e7eb]">
                <p>작성 시각: {new Date(report.generatedAt).toLocaleString("ko-KR")}</p>
                <p>
                  회원: {report.member.nickname || report.member.name} (
                  {report.member.loginId || report.member.email || "소셜 계정"})
                </p>
                <p>예측일: {fmt(report.predictDate)}</p>
                <p>관측: {fmt(report.observedAt)}</p>
                <p>데이터: {report.sourceLabel}</p>
              </section>

              <section>
                <p className="mb-1.5 text-[11px] font-semibold tracking-wide text-[#9ca3af] uppercase">
                  요약
                </p>
                <ul className="space-y-1">
                  <li>대상 시군구: {report.summary.regionCount}곳</li>
                  <li>전국 평균 산불위험지수: {fmtNum(report.summary.averageRiskIndex)}</li>
                  <li>
                    최고:{" "}
                    {report.summary.highest
                      ? `${report.summary.highest.name} (${fmtNum(report.summary.highest.riskIndex)})`
                      : "—"}
                  </li>
                  <li>
                    최저:{" "}
                    {report.summary.lowest
                      ? `${report.summary.lowest.name} (${fmtNum(report.summary.lowest.riskIndex)})`
                      : "—"}
                  </li>
                </ul>
              </section>

              <section>
                <p className="mb-1.5 text-[11px] font-semibold tracking-wide text-[#9ca3af] uppercase">
                  표본 기상
                </p>
                <ul className="grid grid-cols-2 gap-1">
                  <li>기온 {fmtNum(report.sampleWeather.temp_avg, "℃")}</li>
                  <li>습도 {fmtNum(report.sampleWeather.humidity_avg, "%")}</li>
                  <li>풍속 {fmtNum(report.sampleWeather.wind_avg, "m/s")}</li>
                  <li>강수 {fmtNum(report.sampleWeather.precip, "mm")}</li>
                </ul>
              </section>

              <section>
                <p className="mb-1.5 text-[11px] font-semibold tracking-wide text-[#9ca3af] uppercase">
                  위험지수 상위 10
                </p>
                <ol className="list-decimal space-y-0.5 pl-4">
                  {report.topHigh.map((r, i) => (
                    <li key={`${r.name}-${i}`}>
                      {r.name}
                      {r.province ? ` (${r.province})` : ""} — {fmtNum(r.riskIndex)}
                    </li>
                  ))}
                </ol>
              </section>

              <section>
                <p className="mb-1.5 text-[11px] font-semibold tracking-wide text-[#9ca3af] uppercase">
                  위험지수 하위 5
                </p>
                <ol className="list-decimal space-y-0.5 pl-4">
                  {report.topLow.map((r, i) => (
                    <li key={`${r.name}-low-${i}`}>
                      {r.name}
                      {r.province ? ` (${r.province})` : ""} — {fmtNum(r.riskIndex)}
                    </li>
                  ))}
                </ol>
              </section>

              <p className="text-[11px] leading-snug text-[#6b7280]">{report.note}</p>

              <button
                type="button"
                disabled={pdfBusy}
                onClick={() => void downloadPdf()}
                className="w-full rounded-xl bg-[#166534] px-3 py-2.5 text-[12px] font-semibold text-white hover:bg-[#14532d] disabled:opacity-50"
              >
                {pdfBusy ? "PDF 생성 중…" : "슬라이드형 PDF 다운로드"}
              </button>
              {pdfError && <p className="text-[11px] text-[#e03131]">{pdfError}</p>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
