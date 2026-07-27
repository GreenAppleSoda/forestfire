/**
 * ForestFire Express API — 공개 웹 백엔드
 * - 지도/산 JSON 서빙 (UI용 DTO)
 * - Flask ml-service 프록시 + 응답 화이트리스트
 */
import { createApp } from "./app.js";
import { FRONTEND_ORIGIN, ML_SERVICE_URL, PORT } from "./config.js";

const app = createApp();

app.listen(PORT, "0.0.0.0", () => {
  console.log(`[backend] http://localhost:${PORT}  (CORS: ${FRONTEND_ORIGIN})`);
  console.log(`[backend] ml-service → ${ML_SERVICE_URL}`);
});
