/** 候选发现：按配置里的主题 / 关键词查询 GitHub Search API，合并去重后取 star 量级最高的 N 个。 */
import { config } from "../../src/lib/config.mjs";

const DAY = 864e5;

export function buildQueries(now = new Date()) {
  const filters = config.candidateFilters ?? {};
  const pushedSince = new Date(now.getTime() - (filters.pushedWithinDays ?? 75) * DAY)
    .toISOString()
    .slice(0, 10);

  return (config.candidateQueries ?? []).map((q) => {
    const parts = [];
    if (q.topic) parts.push(`topic:${q.topic}`);
    if (q.keywords) parts.push(`${q.keywords} in:name,description`);
    if (q.minStars) parts.push(`stars:>${q.minStars}`);
    parts.push(`pushed:>${pushedSince}`);
    return parts.join(" ");
  });
}

/**
 * @returns {Promise<{pool: object[], queries: string[]}>} pool 已按 star 降序截断
 */
export async function discoverCandidates(client, { now = new Date(), log = console.log } = {}) {
  const filters = config.candidateFilters ?? {};
  // MAX_CANDIDATES 用于本地/CI 冒烟：只跑前 N 个候选，验证链路是否通畅
  const override = Number(process.env.MAX_CANDIDATES ?? 0);
  const max = Number.isFinite(override) && override > 0 ? override : config.pool?.maxCandidates ?? 45;
  const queries = buildQueries(now);
  const found = new Map();
  let failures = 0;

  for (const q of queries) {
    try {
      const items = await client.search(q);
      for (const r of items) {
        if (filters.excludeArchived !== false && r.archived) continue;
        if (filters.excludeForks !== false && r.fork) continue;
        if (!found.has(r.full_name)) found.set(r.full_name, r);
      }
    } catch (e) {
      failures++;
      log(`  ! search failed (${q}): ${e.message}`);
    }
  }

  if (!found.size) throw new Error("candidate discovery returned nothing (all queries failed)");

  const pool = [...found.values()]
    .sort((a, b) => b.stargazers_count - a.stargazers_count)
    .slice(0, max);

  log(`candidates: ${pool.length} (from ${found.size} unique, ${queries.length - failures}/${queries.length} queries ok)`);
  return { pool, queries };
}
