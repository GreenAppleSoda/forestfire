/** API 응답을 JSON으로 읽는다. 프록시 실패 시 plain text(Internal Server Error)도 안내 메시지로 변환. */
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
    if (/^Internal Server Error/i.test(snippet) || res.status >= 500) {
      throw new Error(
        "API 서버(backend) 연결이 끊겼습니다. backend(:4000)가 실행 중인지 확인한 뒤 다시 시도해 주세요.",
      );
    }
    throw new Error(
      snippet
        ? `서버 응답이 JSON이 아닙니다 (${res.status}): ${snippet}`
        : `서버 오류 (${res.status})`,
    );
  }
}
