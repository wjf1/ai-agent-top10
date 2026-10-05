/**
 * LLM 解读生成（可选）。
 *
 * 规则化版本在 src/lib/interpret.mjs，供流水线兜底与构建期聚合复用；
 * 这里只保留需要网络与密钥的 LLM 部分，任何失败都静默回落到规则版。
 *
 * 分工：LLM 负责「项目介绍 / 卡片一行版 / 亮点」——这些要把 README 读成人话，
 * 规则模板做不到；「为什么上榜」始终由规则版按当日指标生成，模型不参与复述数字。
 *
 * 可靠性（T1.3）：
 *   - 支持备用 provider（config.interpretation.fallback / LLM_FALLBACK_*），主服务失败自动切换；
 *   - README 摘要未变化的仓库复用本地缓存（src/data/snapshots/interpret-cache.json），
 *     既省 token 又降低单点失败概率。
 */
import { categoryLabel } from "../../src/lib/categorize.mjs";
import { config } from "../../src/lib/config.mjs";
import { normalizeInterpretation } from "../../src/lib/interpret.mjs";
import {
  computeHash,
  getCachedInterpretation,
  loadInterpretCache,
  saveInterpretCache,
  setCachedInterpretation,
} from "./interpret-cache.mjs";

export { normalizeInterpretation, ruleBasedInterpretation } from "../../src/lib/interpret.mjs";

const LLM_SYSTEM_PROMPT = `你是「AI Agent 日报」的编辑，为 GitHub 项目写通俗易懂的双语解读，读者是关注 AI Agent 的开发者。

只依据给定材料（仓库描述、README 摘要、语言 / 分类 / 话题）写作。严禁编造材料中没有的功能、性能数字、融资金额、用户数量或版本号 —— 宁可少写一条，也不要凭空补一个特性。
只输出一个 JSON 对象，结构如下：
{"entries":[{"full_name":"owner/repo","intro":{"zh":"...","en":"..."},"cardLine":{"zh":"...","en":"..."},"highlights":[{"zh":"...","en":"..."}]}]}

- intro（项目介绍）：2-3 句，讲清这是什么、解决什么问题、怎么用；口语化，不堆术语，可以带一个典型使用场景。中文 60-120 字。
- cardLine（卡片一行版）：中文不超过 45 字，一句话说清「它是什么、能干什么」。
- highlights（亮点）：3-4 条，每条要落到「能干什么」或具体场景，中文每条 20-40 字；不要复述 star / fork / 贡献者数量这类指标，它们会由数据行展示。
不要输出「为什么上榜」，那部分由系统按指标生成。
不要 markdown 代码块，不要额外说明文字。`;

/**
 * 解析一个 provider 配置。
 * @param {string} prefix 备用 provider 的环境变量前缀（如 "LLM_FALLBACK_"），主 provider 传空串。
 *   前缀形式：`${prefix}BASE_URL` / `${prefix}MODEL` / `${prefix}API_KEY`。
 */
function resolveProvider(cfg, { prefix = "" } = {}) {
  const scoped = (name) => (prefix ? process.env[`${prefix}${name}`] : undefined);
  const apiKeyEnv = cfg.apiKeyEnv || "LLM_API_KEY";
  return {
    baseUrl: scoped("BASE_URL") || process.env.LLM_BASE_URL || cfg.baseUrl || "https://api.openai.com/v1",
    model: scoped("MODEL") || process.env.LLM_MODEL || cfg.model || "gpt-4o-mini",
    apiKey: scoped("API_KEY") || process.env[apiKeyEnv] || process.env.LLM_API_KEY || "",
  };
}

/** 单次请求一个 provider；失败返回 null（不抛） */
async function requestInterpretation(provider, payload, cfg, log) {
  if (!provider.apiKey) {
    log(`interpretation: skip ${provider.model} (no api key)`);
    return null;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs ?? 45000);
  try {
    const base = provider.baseUrl.replace(/\/$/, "");
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${provider.apiKey}` },
      body: JSON.stringify({
        model: provider.model,
        temperature: cfg.temperature ?? 0.4,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: LLM_SYSTEM_PROMPT },
          { role: "user", content: JSON.stringify(payload) },
        ],
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      log(`interpretation: ${provider.model} returned ${res.status}`);
      return null;
    }
    const data = await res.json();
    const parsed = JSON.parse(data.choices?.[0]?.message?.content ?? "{}");
    const out = new Map();
    for (const item of parsed.entries ?? []) {
      const normalized = normalizeInterpretation(item);
      if (normalized && typeof item.full_name === "string") out.set(item.full_name, { ...normalized, source: "llm" });
    }
    log(`interpretation: ${provider.model} produced ${out.size} entries`);
    return out.size ? out : null;
  } catch (e) {
    log(`interpretation: ${provider.model} failed (${e.message})`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @param {Array} projects 待生成解读的榜单项目
 * @param {object} opts { log, cachePath, useCache }
 * @returns {Promise<Map<string, object>>} full_name -> 解读对象（失败时为空 Map）
 */
export async function llmInterpretation(projects, { log = console.log, cachePath, useCache = true } = {}) {
  const cfg = config.interpretation ?? {};

  if (cfg.provider === "none") {
    log("interpretation: rules (LLM disabled in config)");
    return new Map();
  }

  const selected = projects.slice(0, cfg.maxEntries ?? 10);
  const payload = selected.map((p) => ({
    full_name: p.full_name,
    description: p.description,
    // 项目介绍要读得懂 README；拿不到就留空，模型会退回描述句
    readme_excerpt: p.readmeExcerpt ?? "",
    language: p.language,
    category: categoryLabel(p.category, "en"),
    topics: p.topics,
  }));

  const out = new Map();
  const cache = useCache ? loadInterpretCache(cachePath) : {};
  const pending = [];

  // 1) 先用缓存命中（README 摘要 + 描述未变才复用）
  for (const p of selected) {
    const content = `${p.description ?? ""}\n${p.readmeExcerpt ?? ""}`;
    const hit = useCache ? getCachedInterpretation(cache, p.full_name, content) : null;
    if (hit) {
      out.set(p.full_name, { ...hit, source: "llm" });
    } else {
      pending.push(p);
    }
  }
  if (out.size) log(`interpretation: ${out.size} entries served from cache`);

  if (!pending.length) return out;

  const pendingPayload = payload.filter((p) => pending.some((q) => q.full_name === p.full_name));

  // 2) 主 provider → 备用 provider 依次尝试
  const primary = resolveProvider(cfg, { prefix: "" });
  const fallbackCfg = cfg.fallback ?? {};
  const fallback = resolveProvider(fallbackCfg, { prefix: "LLM_FALLBACK_" });
  const hasFallback = !!(fallbackCfg.baseUrl || process.env.LLM_FALLBACK_BASE_URL);

  let fetched = await requestInterpretation(primary, pendingPayload, cfg, log);
  if (!fetched && hasFallback) {
    log("interpretation: primary failed, trying fallback provider");
    fetched = await requestInterpretation(fallback, pendingPayload, cfg, log);
  }
  if (!fetched) {
    log("interpretation: falling back to rules");
    return out;
  }

  // 3) 合并新结果并写回缓存
  let cacheDirty = false;
  for (const [fullName, data] of fetched) {
    out.set(fullName, data);
    const p = pending.find((q) => q.full_name === fullName);
    if (p && useCache) {
      setCachedInterpretation(cache, fullName, `${p.description ?? ""}\n${p.readmeExcerpt ?? ""}`, data);
      cacheDirty = true;
    }
  }
  if (cacheDirty) saveInterpretCache(cache, cachePath);

  // 未拿到 LLM 解读的条目交给调用方回落规则版
  if (out.size < selected.length) {
    log(`interpretation: ${selected.length - out.size}/${selected.length} entries will fall back to rules`);
  }
  return out;
}
