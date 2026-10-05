import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { writeJson } from "./persist.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DEFAULT_CACHE_PATH = resolve(__dirname, "../../src/data/snapshots/interpret-cache.json");

export function computeHash(content) {
  return createHash("sha256").update(String(content ?? "").trim()).digest("hex").slice(0, 16);
}

export function loadInterpretCache(filePath = DEFAULT_CACHE_PATH) {
  if (!existsSync(filePath)) return {};
  try {
    const raw = readFileSync(filePath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export function saveInterpretCache(cache, filePath = DEFAULT_CACHE_PATH) {
  try {
    writeJson(filePath, cache);
  } catch (e) {
    console.error(`interpret-cache: failed to save cache (${e.message})`);
  }
}

export function getCachedInterpretation(cache, fullName, content) {
  if (!cache || !fullName) return null;
  const entry = cache[fullName];
  if (!entry || !entry.hash || !entry.data) return null;
  const currentHash = computeHash(content);
  if (entry.hash === currentHash) {
    return entry.data;
  }
  return null;
}

export function setCachedInterpretation(cache, fullName, content, data) {
  if (!cache || !fullName || !data) return;
  cache[fullName] = {
    hash: computeHash(content),
    cachedAt: new Date().toISOString(),
    data,
  };
}
