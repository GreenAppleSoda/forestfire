import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** ForestFire 저장소 루트 */
export const ROOT = path.resolve(__dirname, "../..");

dotenv.config({ path: path.join(ROOT, "backend", ".env") });

export const PORT = Number(process.env.PORT || 4000);
export const FRONTEND_ORIGIN =
  process.env.FRONTEND_ORIGIN || "http://localhost:3000";
export const ML_SERVICE_URL = (
  process.env.ML_SERVICE_URL || "http://127.0.0.1:5000"
).replace(/\/$/, "");
export const PREDICT_CACHE_MS = Number(
  process.env.PREDICT_CACHE_MS || 30 * 60 * 1000,
);
/**
 * backend 자체 지도 데이터 폴더 (frontend 폴더를 직접 읽지 않음).
 * etl(build_admin_layers · export_map_data · compress_web_data ·
 * refresh_history_layers)이 frontend/public/data를 갱신할 때마다
 * 같은 파일을 여기로도 복사합니다 (etl/paths.py의 sync_backend_data).
 * 다른 위치를 쓰려면 .env의 DATA_DIR에 ROOT 기준 상대경로를 지정하세요.
 */
export const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(ROOT, process.env.DATA_DIR)
  : path.join(ROOT, "backend", "data");
