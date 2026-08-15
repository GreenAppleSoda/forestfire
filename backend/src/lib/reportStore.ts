/** 생성된 PDF 임시 보관 (메모리, TTL) — DB 저장 없음 */
type Entry = {
  buffer: Buffer;
  filename: string;
  expiresAt: number;
};

const TTL_MS = 30 * 60 * 1000;
const store = new Map<string, Entry>();

function prune(): void {
  const now = Date.now();
  for (const [id, e] of store) {
    if (e.expiresAt <= now) store.delete(id);
  }
}

export function putReportPdf(id: string, buffer: Buffer, filename: string): void {
  prune();
  store.set(id, { buffer, filename, expiresAt: Date.now() + TTL_MS });
}

export function getReportPdf(id: string): Entry | null {
  prune();
  const e = store.get(id);
  if (!e) return null;
  if (e.expiresAt <= Date.now()) {
    store.delete(id);
    return null;
  }
  return e;
}
