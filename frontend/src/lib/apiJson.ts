/** API 응답을 JSON으로 읽는다. 프록시 실패 시 plain text도 안내 메시지로 변환. */
export async function readApiJson<T = {
  ok?: boolean;
  error?: string;
  data?: unknown;
  cached?: boolean;
}>(res: Response): Promise<T> {
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    const snippet = text.replace(/\s+/g, " ").trim().slice(0, 100);
    if (!snippet) {
      throw new Error(
        res.status >= 500
          ? "서버가 일시적으로 응답하지 못했습니다. 잠시 후 다시 시도해 주세요."
          : `서버 응답이 비어 있습니다 (${res.status})`,
      );
    }
    if (/^Internal Server Error/i.test(snippet) || res.status >= 500) {
      throw new Error(
        "서버 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.",
      );
    }
    throw new Error(`서버 응답이 JSON이 아닙니다 (${res.status}): ${snippet}`);
  }
}
