/**
 * ForestFire Express API — 공개 웹 백엔드
 * - 지도/산 JSON 서빙 (UI용 DTO)
 * - Flask ml-service 프록시 + 응답 화이트리스트
 */
import { createApp } from "./app.js";
import { FRONTEND_ORIGIN, ML_SERVICE_URL, PORT } from "./config.js";
import { runPredictDaily } from "./lib/predictService.js";

const app = createApp();

/** Flask가 늦게 뜰 수 있어 몇 번 재시도한 뒤 캐시에 당일 예측을 올려 둔다. */
async function warmupDailyPredict() {
  const delaysMs = [1500, 4000, 8000];
  for (let i = 0; i < delaysMs.length; i++) {
    await new Promise((resolve) => setTimeout(resolve, delaysMs[i]));
    try {
      const result = await runPredictDaily({ source: "kma" });
      if (result.ok) {
        console.log(
          "[backend] daily predict warmup ok",
          `cached=${Boolean(result.cached)}`,
          `n=${result.data?.n_regions ?? "?"}`,
        );
        return;
      }
      console.warn(
        `[backend] daily predict warmup fail (${i + 1}/${delaysMs.length})`,
        result.error,
      );
    } catch (e) {
      console.warn(
        `[backend] daily predict warmup error (${i + 1}/${delaysMs.length})`,
        e,
      );
    }
  }
  console.warn("[backend] daily predict warmup gave up — frontend will retry");
}

app.listen(PORT, "0.0.0.0", () => {
  console.log(`[backend] http://localhost:${PORT}  (CORS: ${FRONTEND_ORIGIN})`);
  console.log(`[backend] ml-service → ${ML_SERVICE_URL}`);
  void warmupDailyPredict();
});
