/**
 * Express 앱 조립 — 미들웨어 + 라우트 마운트
 */
import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import { FRONTEND_ORIGIN } from "./config.js";
import { optionalAuth } from "./middleware/optionalAuth.js";
import authRoutes from "./routes/auth.js";
import chatRoutes from "./routes/chat.js";
import healthRoutes from "./routes/health.js";
import mapRoutes from "./routes/map.js";
import predictRoutes from "./routes/predict.js";
import reportRoutes from "./routes/report.js";
import wildfiresRoutes from "./routes/wildfires.js";

export function createApp() {
  const app = express();

  app.use(
    cors({
      origin: FRONTEND_ORIGIN,
      methods: ["GET", "POST", "OPTIONS"],
      credentials: true,
    }),
  );
  app.use(express.json({ limit: "256kb" }));
  app.use(cookieParser());
  app.use(optionalAuth);

  app.use("/api", healthRoutes);
  app.use("/api", mapRoutes);
  app.use("/api", predictRoutes);
  app.use("/api", wildfiresRoutes);
  app.use("/api", authRoutes);
  app.use("/api", chatRoutes);
  app.use("/api", reportRoutes);

  return app;
}
