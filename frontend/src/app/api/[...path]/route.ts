/**
 * /api/* → Express(:4000) 프록시.
 * Next rewrite 대신 Route Handler를 써서
 * - 장시간 예측/동기화 타임아웃을 넉넉히 두고
 * - 연결 실패 시에도 항상 JSON 에러를 돌려준다
 *   (rewrite 실패 시 plain "Internal Server Error" → 프론트 JSON 파싱 에러 방지)
 * - 로그인 쿠키(Cookie / Set-Cookie)를 양방향으로 전달
 */
export const runtime = "nodejs";
export const maxDuration = 180;

const EXPRESS_URL = (
  process.env.EXPRESS_URL || "http://127.0.0.1:4000"
).replace(/\/$/, "");

function timeoutMsFor(pathParts: string[]): number {
  const root = pathParts[0] || "";
  if (root === "predict" || root === "wildfires" || root === "chat" || root === "report") {
    return 180_000;
  }
  return 60_000;
}

async function proxy(
  req: Request,
  ctx: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  const { path: pathParts } = await ctx.params;
  const incoming = new URL(req.url);
  const target = `${EXPRESS_URL}/api/${pathParts.join("/")}${incoming.search}`;

  try {
    const headers = new Headers();
    const contentType = req.headers.get("content-type");
    if (contentType) headers.set("content-type", contentType);
    const cookie = req.headers.get("cookie");
    if (cookie) headers.set("cookie", cookie);

    const method = req.method.toUpperCase();
    const init: RequestInit = {
      method,
      headers,
      signal: AbortSignal.timeout(timeoutMsFor(pathParts)),
    };

    if (method !== "GET" && method !== "HEAD") {
      init.body = await req.arrayBuffer();
    }

    const upstream = await fetch(target, init);
    const body = await upstream.arrayBuffer();
    const outHeaders = new Headers();
    const upstreamCt = upstream.headers.get("content-type");
    if (upstreamCt) outHeaders.set("content-type", upstreamCt);

    // Node fetch: getSetCookie() 로 복수 Set-Cookie 보존
    const setCookies =
      typeof upstream.headers.getSetCookie === "function"
        ? upstream.headers.getSetCookie()
        : [];
    if (setCookies.length > 0) {
      for (const c of setCookies) {
        outHeaders.append("set-cookie", c);
      }
    } else {
      const single = upstream.headers.get("set-cookie");
      if (single) outHeaders.set("set-cookie", single);
    }

    return new Response(body, {
      status: upstream.status,
      headers: outHeaders,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const timedOut =
      (e instanceof Error && e.name === "TimeoutError") ||
      /timeout|aborted|AbortError/i.test(msg);
    const disconnected = /ECONNRESET|ECONNREFUSED|fetch failed|socket hang up/i.test(
      msg,
    );
    const transient =
      e instanceof SyntaxError ||
      /Unexpected end of JSON|JSON\.parse/i.test(msg);

    let error =
      "API 서버(backend)에 연결할 수 없습니다. backend(:4000)가 실행 중인지 확인해 주세요.";
    if (timedOut) {
      error = "요청 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요.";
    } else if (disconnected || transient) {
      error =
        "서버가 일시적으로 응답하지 못했습니다. 잠시 후 다시 시도해 주세요.";
    }

    return Response.json(
      { ok: false, error, detail: msg },
      { status: 502 },
    );
  }
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ path: string[] }> },
) {
  return proxy(req, ctx);
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ path: string[] }> },
) {
  return proxy(req, ctx);
}

export async function PUT(
  req: Request,
  ctx: { params: Promise<{ path: string[] }> },
) {
  return proxy(req, ctx);
}

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ path: string[] }> },
) {
  return proxy(req, ctx);
}

export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ path: string[] }> },
) {
  return proxy(req, ctx);
}
