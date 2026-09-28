/**
 * LLM 解读生成（可选）。
 *
 * 规则化版本在 src/lib/interpret.mjs，供流水线兜底与构建期聚合复用；
 * 这里只保留需要网络与密钥的 LLM 部分，任何失败都静默回落到规则版。
 *
 * 分工：LLM 负责「项目介绍 / 卡片一行版 / 亮点」——这些要把 README 读成人话，
 * 规则模板做不到；「为什么上榜」始终由规则版按当日指标生成，模型不参与复述数字。
 */
import { categoryLabel } from "../../src/lib/categorize.mjs";
import { config } from "../../src/lib/config.mjs";
import { normalizeInterpretation } from "../../src/lib/interpret.mjs";

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
 * @returns {Promise<Map<string, object>>} full_name -> 解读对象（失败时为空 Map）
 */
export async function llmInterpretation(projects, { log = console.log } = {}) {
  const cfg = config.interpretation ?? {};
  // 本机默认用 config 里配的网关；CI 等环境用环境变量指向任意兼容服务
  // （config 里写死的 127.0.0.1 在 runner 上不可达，必须能被覆盖）
  const baseUrl = process.env.LLM_BASE_URL || cfg.baseUrl || "https://api.openai.com/v1";
  const model = process.env.LLM_MODEL || cfg.model || "gpt-4o-mini";
  const apiKeyEnv = cfg.apiKeyEnv ?? "LLM_API_KEY";
  const apiKey = process.env[apiKeyEnv] || process.env.LLM_API_KEY || "";

  if (cfg.provider === "none") {
    log("interpretation: rules (LLM disabled in config)");
    return new Map();
  }
  if (!apiKey) {
    log(`interpretation: rules (neither ${apiKeyEnv} nor LLM_API_KEY is set)`);
    return new Map();
  }

  const payload = projects.slice(0, cfg.maxEntries ?? 10).map((p) => ({
    full_name: p.full_name,
    description: p.description,
    // 项目介绍要读得懂 README；拿不到就留空，模型会退回描述句
    readme_excerpt: p.readmeExcerpt ?? "",
    language: p.language,
    category: categoryLabel(p.category, "en"),
    topics: p.topics,
  }));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs ?? 45000);
  try {
    const base = baseUrl.replace(/\/$/, "");
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
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
      log(`interpretation: LLM returned ${res.status}, falling back to rules`);
      return new Map();
    }
    const data = await res.json();
    const parsed = JSON.parse(data.choices?.[0]?.message?.content ?? "{}");
    const out = new Map();
    for (const item of parsed.entries ?? []) {
      const normalized = normalizeInterpretation(item);
      if (normalized && typeof item.full_name === "string") out.set(item.full_name, { ...normalized, source: "llm" });
    }
    log(`interpretation: LLM produced ${out.size} entries`);
    return out;
  } catch (e) {
    log(`interpretation: LLM failed (${e.message}), falling back to rules`);
    return new Map();
  } finally {
    clearTimeout(timer);
  }
}
