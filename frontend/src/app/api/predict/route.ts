import { spawn } from "child_process";
import path from "path";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** 메모리 캐시: 같은 출처 재요청 시 30분 재사용 */
let cache: { at: number; data: unknown; source: string } | null = null;
const CACHE_MS = 30 * 60 * 1000;

type Body = {
  date?: string;
  source?: "kma" | "manual" | "open_meteo";
  force?: boolean;
  temp_avg?: number;
  temp_min?: number;
  temp_max?: number;
  precip?: number;
  wind_avg?: number;
  wind_max?: number;
  humidity_avg?: number;
  humidity_min?: number;
  open_meteo?: boolean;
};

function runPredict(args: string[]): Promise<{ code: number; out: string; err: string }> {
  const root = path.resolve(process.cwd(), "..");
  const script = path.join(root, "backend", "predict_daily_risk.py");
  return new Promise((resolve) => {
    const child = spawn("python", [script, ...args], {
      cwd: root,
      env: {
        ...process.env,
        PYTHONIOENCODING: "utf-8",
        // Next가 로드한 .env.local 키가 파이썬으로 전달됨
      },
      shell: process.platform === "win32",
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => {
      out += d.toString();
    });
    child.stderr.on("data", (d) => {
      err += d.toString();
    });
    child.on("close", (code) => {
      resolve({ code: code ?? 1, out, err });
    });
  });
}

async function readDailyJson() {
  const fs = await import("fs/promises");
  const dailyPath = path.join(process.cwd(), "public", "data", "daily_ml_risk.json");
  const raw = await fs.readFile(dailyPath, "utf-8");
  return JSON.parse(raw);
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as Body;
    const source = body.source ?? "kma";
    const args: string[] = [];
    if (body.date) args.push("--date", body.date);

    const numFlags: Array<[keyof Body, string]> = [
      ["temp_avg", "--temp-avg"],
      ["temp_min", "--temp-min"],
      ["temp_max", "--temp-max"],
      ["precip", "--precip"],
      ["wind_avg", "--wind-avg"],
      ["wind_max", "--wind-max"],
      ["humidity_avg", "--humidity-avg"],
      ["humidity_min", "--humidity-min"],
    ];
    let hasWeather = false;
    for (const [key, flag] of numFlags) {
      const v = body[key];
      if (typeof v === "number" && !Number.isNaN(v)) {
        args.push(flag, String(v));
        if (key === "temp_avg") hasWeather = true;
      }
    }

    if (hasWeather || source === "manual") {
      // CLI 기상
    } else if (source === "open_meteo" || body.open_meteo) {
      args.push("--open-meteo");
    } else {
      args.push("--kma");
    }

    // 캐시: KMA 실시간만
    if (
      !body.force &&
      !hasWeather &&
      source === "kma" &&
      cache &&
      Date.now() - cache.at < CACHE_MS
    ) {
      return NextResponse.json({
        ok: true,
        data: cache.data,
        cached: true,
        log: "cache hit",
      });
    }

    const result = await runPredict(args);
    if (result.code !== 0) {
      return NextResponse.json(
        {
          ok: false,
          error: result.err || result.out || "예측 실패",
        },
        { status: 500 },
      );
    }

    const data = await readDailyJson();
    if (!hasWeather && source === "kma") {
      cache = {
        at: Date.now(),
        data,
        source: String(data.weather_source || "kma"),
      };
    }
    return NextResponse.json({ ok: true, data, log: result.out, cached: false });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

/** GET: 캐시된/저장된 당일 예측 조회. ?refresh=1 이면 KMA 재실행 */
export async function GET(req: NextRequest) {
  try {
    const refresh = req.nextUrl.searchParams.get("refresh") === "1";
    if (!refresh && cache && Date.now() - cache.at < CACHE_MS) {
      return NextResponse.json({ ok: true, data: cache.data, cached: true });
    }
    if (!refresh) {
      try {
        const data = await readDailyJson();
        return NextResponse.json({ ok: true, data, cached: false });
      } catch {
        /* fall through to run */
      }
    }
    const result = await runPredict(["--kma"]);
    if (result.code !== 0) {
      return NextResponse.json(
        { ok: false, error: result.err || result.out || "예측 실패" },
        { status: 500 },
      );
    }
    const data = await readDailyJson();
    cache = { at: Date.now(), data, source: String(data.weather_source || "kma") };
    return NextResponse.json({ ok: true, data, log: result.out, cached: false });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
