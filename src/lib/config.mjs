/**
 * 配置加载器：读取 config/scoring.json（单一事实来源）。
 *
 * 该模块同时被 Node 流水线（scripts/）与 Astro 构建期组件引用。
 * 只在服务端 / 构建期执行，不会进入客户端 bundle。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const CONFIG_PATH = path.resolve(here, "..", "..", "config", "scoring.json");

export const config = Object.freeze(JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")));

/** 维度定义（含权重、双语名、说明、公式参数） */
export const dimensions = config.dimensions;
export const dimensionKeys = dimensions.map((d) => d.key);

/** 按 key 读取维度定义 */
export function dim(key) {
  const found = dimensions.find((d) => d.key === key);
  if (!found) throw new Error(`unknown dimension: ${key}`);
  return found;
}

/** 读取某维度的公式参数（带默认值兜底，避免新增参数时到处改代码） */
export function param(key, name, fallback = 0) {
  const value = dim(key).params?.[name];
  return typeof value === "number" ? value : fallback;
}

export function categoryDefs() {
  return config.categories ?? [];
}

export function windowDays(kind = "weekly") {
  return config.window?.[kind] ?? 7;
}

export default config;
