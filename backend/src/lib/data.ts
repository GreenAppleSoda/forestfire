import fs from "node:fs/promises";
import path from "node:path";
import { DATA_DIR } from "../config.js";
import type { JsonObject } from "../types.js";

type CacheEntry = {
  mtimeMs: number;
  json: JsonObject;
};

const jsonCache = new Map<string, CacheEntry>();

export async function readJson(name: string): Promise<JsonObject> {
  const full = path.join(DATA_DIR, name);
  const raw = await fs.readFile(full, "utf-8");
  return JSON.parse(raw) as JsonObject;
}

export async function readJsonCached(name: string): Promise<JsonObject> {
  const full = path.join(DATA_DIR, name);
  const stat = await fs.stat(full);
  const cached = jsonCache.get(full);
  if (cached && cached.mtimeMs === stat.mtimeMs) {
    return cached.json;
  }

  const raw = await fs.readFile(full, "utf-8");
  const json = JSON.parse(raw) as JsonObject;
  jsonCache.set(full, { mtimeMs: stat.mtimeMs, json });
  return json;
}
