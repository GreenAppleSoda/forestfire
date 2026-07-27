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
export const DATA_DIR = path.join(ROOT, "frontend", "public", "data");
