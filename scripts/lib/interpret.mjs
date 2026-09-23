/**
 * LLM 解读生成（可选，W4-3）。
 *
 * 规则化版本在 src/lib/interpret.mjs，供流水线兜底与构建期聚合复用；
 * 这里只保留需要网络与密钥的 LLM 部分，任何失败都静默回落到规则版。
 */
import { categoryLabel } from "../../src/lib/categorize.mjs";
import { config } from "../../src/lib/config.mjs";
import { normalizeInterpretation } from "../../src/lib/interpret.mjs";

export { normalizeInterpretation, ruleBasedInterpretation } from "../../src/lib/interpret.mjs";

const LLM_SYSTEM_PROMPT = `You write concise, factual release notes for a daily "AI Agent Top 10" board.
Return ONLY a JSON object with this exact shape:
{"entries":[{"full_name":"owner/repo","why":{"zh":"...","en":"..."},"highlights":[{"zh":"...","en":"..."}],"cons":[{"zh":"...","en":"..."}],"fitFor":[{"zh":"...","en":"..."}],"quickstart":"..."}]}
Rules: use only the facts given in the input; never invent features, benchmarks, user counts, or funding.
why: one paragraph, 60-120 Chinese characters / 40-80 English words. highlights: 2-4 items. cons: 1-3 items.
fitFor: 2 items describing who should adopt it. quickstart: 3-6 shell lines of setup commands.
No markdown fences, no extra prose, no trailing commentary.`;

/**
 * @returns {Promise<Map<string, object>>} full_name -> 解读对象（失败时为空 Map）
 */
export async function llmInterpretation(projects, { log = console.log } = {}) {
  const cfg = config.interpretation ?? {};
  const apiKey = process.env[cfg.apiKeyEnv ?? "LLM_API_KEY"];

  if (cfg.provider === "none") {
    log("interpretation: rules (LLM disabled in config)");
    return new Map();
  }
  if (!apiKey) {
    log(`interpretation: rules (env ${cfg.apiKeyEnv ?? "LLM_API_KEY"} not set)`);
    return new Map();
  }

  const payload = projects.slice(0, cfg.maxEntries ?? 10).map((p) => ({
    full_name: p.full_name,
    category: categoryLabel(p.category, "en"),
    language: p.language,
    description: p.description,
    topics: p.topics,
    stars: p.metrics.stars,
    forks: p.metrics.forks,
    stars_7d: p.weeklyGain,
    forks_7d: p.forksGain,
    contributors: p.metrics.contributors,
    releases_90d: p.metrics.releases90d,
    prs_30d: p.metrics.prActivity,
    issues_30d: p.metrics.issueActivity,
    license: p.metrics.license,
    last_push_days_ago: p.metrics.pushDaysAgo,
    open_issues: p.metrics.openIssues,
    scores: p.scores,
  }));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs ?? 45000);
  try {
    const base = (cfg.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "");
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: cfg.model ?? "gpt-4o-mini",
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
