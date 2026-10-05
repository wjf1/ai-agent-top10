/**
 * 相关项目推荐（T2.3）——纯函数，不依赖构建期数据加载。
 *
 * 与 aggregate.ts 分开：aggregate 需要读取构建期索引（extensionless 导入，只有
 * Astro/Vite 能解析），而这里的相似度与挑选逻辑是可单测的纯函数。
 */
import type { Entry } from "./load-days";

/** 相似度 = 同分类（+2）+ topics 交集数量 */
export function scoreSimilarity(a: Entry, b: Entry): number {
  let score = 0;
  if ((a.category ?? "other") === (b.category ?? "other")) score += 2;
  const bTopics = new Set((b.topics ?? []).map((t) => t.toLowerCase()));
  for (const t of a.topics ?? []) {
    if (bTopics.has(t.toLowerCase())) score += 1;
  }
  return score;
}

export interface RelatedProject {
  entry: Entry;
  kind: "similar" | "hot";
  /** 相似度得分（同期热门为 0） */
  score: number;
  lastDate: string;
}

export interface RelatedPool {
  entry: Entry;
  lastDate: string;
  gain: number;
  [key: string]: unknown;
}

/**
 * 挑选相关项目：先按相似度取「同类项目」，再补「同期热门」（同一天、增量降序）。
 * 两类之间不重复。
 */
export function pickRelated(
  current: Entry,
  date: string,
  pool: RelatedPool[],
  { similar = 3, hot = 2 } = {}
): RelatedProject[] {
  const others = pool.filter((p) => p.entry.full_name !== current.full_name);

  const similarPicks = others
    .map((p) => ({ p, score: scoreSimilarity(current, p.entry) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || b.p.gain - a.p.gain)
    .slice(0, similar)
    .map(({ p, score }) => ({ entry: p.entry, kind: "similar" as const, score, lastDate: p.lastDate }));

  const taken = new Set(similarPicks.map((r) => r.entry.full_name));
  const hotPicks = others
    .filter((p) => p.lastDate === date && !taken.has(p.entry.full_name))
    .sort((a, b) => b.gain - a.gain)
    .slice(0, hot)
    .map((p) => ({ entry: p.entry, kind: "hot" as const, score: 0, lastDate: p.lastDate }));

  return [...similarPicks, ...hotPicks];
}
