import fs from "node:fs/promises";
import path from "node:path";
import { DATA_DIR } from "../config.js";
import type { JsonObject } from "../types.js";

export async function readJson(name: string): Promise<JsonObject> {
  const full = path.join(DATA_DIR, name);
  const raw = await fs.readFile(full, "utf-8");
  return JSON.parse(raw) as JsonObject;
}
